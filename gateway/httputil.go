package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

// ClientConfig holds retry and circuit breaker settings from env.
type ClientConfig struct {
	MaxRetries     int
	BackoffBase    time.Duration
	CircuitThreshold int
	CircuitWindow  time.Duration
	CircuitCooldown time.Duration
}

func loadClientConfig() ClientConfig {
	intEnv := func(key string, def int) int {
		s := os.Getenv(key)
		if s == "" {
			return def
		}
		n, _ := strconv.Atoi(s)
		if n < 0 {
			return def
		}
		return n
	}
	durEnv := func(key string, def time.Duration) time.Duration {
		s := os.Getenv(key)
		if s == "" {
			return def
		}
		n, _ := strconv.Atoi(s)
		if n < 0 {
			return def
		}
		return time.Duration(n) * time.Second
	}
	backoffMs := intEnv("PIPELINE_RETRY_BACKOFF_MS", 100)
	if backoffMs <= 0 {
		backoffMs = 100
	}
	return ClientConfig{
		MaxRetries:        intEnv("PIPELINE_MAX_RETRIES", 3),
		BackoffBase:       time.Duration(backoffMs) * time.Millisecond,
		CircuitThreshold:  intEnv("PIPELINE_CIRCUIT_FAILURE_THRESHOLD", 5),
		CircuitWindow:     durEnv("PIPELINE_CIRCUIT_WINDOW_SEC", 30*time.Second),
		CircuitCooldown:   durEnv("PIPELINE_CIRCUIT_COOLDOWN_SEC", 30*time.Second),
	}
}

var (
	clientConfig   = loadClientConfig()
	circuitBreaker = NewCircuitBreaker(
		clientConfig.CircuitThreshold,
		clientConfig.CircuitWindow,
		clientConfig.CircuitCooldown,
	)
)

// PostWithRetryAndCircuit performs a POST with trace context, retries on retryable errors with exponential backoff,
// and uses the circuit breaker for the given key (e.g. service URL). Body must be a *bytes.Reader so it can be
// reset between retries.
func PostWithRetryAndCircuit(ctx context.Context, client *http.Client, url, contentType string, body *bytes.Reader, circuitKey string) (*http.Response, error) {
	if !circuitBreaker.Allow(circuitKey) {
		return nil, &circuitOpenError{}
	}
	var lastErr error
	var resp *http.Response
	backoff := clientConfig.BackoffBase
	for attempt := 0; attempt <= clientConfig.MaxRetries; attempt++ {
		if attempt > 0 {
			if body != nil {
				_, _ = body.Seek(0, io.SeekStart)
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 3
			if backoff > 5*time.Second {
				backoff = 5 * time.Second
			}
		}
		resp, lastErr = postWithTrace(ctx, client, url, contentType, body)
		if lastErr != nil {
			// Retryable: network error
			circuitBreaker.Failure(circuitKey)
			continue
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			circuitBreaker.Success(circuitKey)
			return resp, nil
		}
		if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode < 600) {
			_ = resp.Body.Close()
			circuitBreaker.Failure(circuitKey)
			lastErr = &httpStatusError{status: resp.StatusCode}
			continue
		}
		circuitBreaker.Success(circuitKey)
		return resp, nil
	}
	return nil, lastErr
}

type circuitOpenError struct{}

func (e *circuitOpenError) Error() string {
	return "service unavailable (circuit open)"
}

type httpStatusError struct {
	status int
}

func (e *httpStatusError) Error() string {
	return "HTTP " + strconv.Itoa(e.status)
}
