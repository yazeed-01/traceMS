package main

import (
	"sync"
	"time"
)

type circuitState int

const (
	stateClosed circuitState = iota
	stateOpen
	stateHalfOpen
)

type circuit struct {
	state       circuitState
	failures    int
	lastFailure time.Time
	lastTry     time.Time
}

// CircuitBreaker holds per-key (e.g. service URL) circuit state.
type CircuitBreaker struct {
	mu          sync.RWMutex
	byKey       map[string]*circuit
	threshold   int
	window      time.Duration
	cooldown    time.Duration
	nowFunc     func() time.Time
}

// NewCircuitBreaker creates a circuit breaker with the given thresholds.
func NewCircuitBreaker(threshold int, window, cooldown time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		byKey:    make(map[string]*circuit),
		threshold: threshold,
		window:   window,
		cooldown: cooldown,
		nowFunc:  time.Now,
	}
}

// Allow returns true if a call is allowed (closed or half-open). If open, returns false.
func (cb *CircuitBreaker) Allow(key string) bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := cb.nowFunc()
	c, ok := cb.byKey[key]
	if !ok {
		return true
	}
	switch c.state {
	case stateClosed:
		return true
	case stateOpen:
		if now.Sub(c.lastFailure) >= cb.cooldown {
			c.state = stateHalfOpen
			c.lastTry = now
			return true
		}
		return false
	case stateHalfOpen:
		return true
	}
	return true
}

// Success records a successful call and resets the circuit for that key.
func (cb *CircuitBreaker) Success(key string) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	c, ok := cb.byKey[key]
	if !ok {
		return
	}
	c.state = stateClosed
	c.failures = 0
}

// Failure records a failed call. If failures reach threshold within window, opens the circuit.
func (cb *CircuitBreaker) Failure(key string) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := cb.nowFunc()
	c, ok := cb.byKey[key]
	if !ok {
		c = &circuit{state: stateClosed}
		cb.byKey[key] = c
	}
	c.lastTry = now
	if c.state == stateHalfOpen {
		c.state = stateOpen
		c.lastFailure = now
		c.failures = cb.threshold
		return
	}
	// In closed state: reset failure count if last failure was outside the window
	if c.state == stateClosed && !c.lastFailure.IsZero() && now.Sub(c.lastFailure) > cb.window {
		c.failures = 0
	}
	c.failures++
	c.lastFailure = now
	if c.failures >= cb.threshold {
		c.state = stateOpen
	}
}
