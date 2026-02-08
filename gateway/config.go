package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// PipelineService is one microservice in the pipeline.
type PipelineService struct {
	Name        string `json:"name" yaml:"name"`
	URL         string `json:"url" yaml:"url"`
	Icon        string `json:"icon" yaml:"icon"`
	Description string `json:"description" yaml:"description"`
	InputType   string `json:"input_type" yaml:"input_type"`
	OutputType  string `json:"output_type" yaml:"output_type"`
}

type pipelineConfig struct {
	Services []PipelineService `yaml:"services"`
}

var (
	configMu        sync.RWMutex
	configMemory    []PipelineService   // nil = not set, load from file (used when not file-authoritative)
	fileCache       []PipelineService   // used when file-authoritative
	fileCacheMtime  time.Time            // mtime of file when fileCache was loaded
	fileCachePath   string               // path we cached from
)

// fileAuthoritative returns true when pipeline config should always be read from file (shared across replicas).
func fileAuthoritative() bool {
	return getWritablePath() != ""
}

func getConfigPath() string {
	if p := os.Getenv("PIPELINE_CONFIG_PATH"); p != "" {
		return p
	}
	return "/app/pipeline.yaml"
}

func getWritablePath() string {
	return os.Getenv("WRITABLE_PIPELINE_PATH")
}

func defaultPipeline() []PipelineService {
	env := func(key, def string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return def
	}
	return []PipelineService{
		{Name: "validator", URL: env("VALIDATOR_URL", "http://validator:8001"), Icon: "✓"},
		{Name: "transformer", URL: env("TRANSFORMER_URL", "http://transformer:8002"), Icon: "⇅"},
		{Name: "enricher", URL: env("ENRICHER_URL", "http://enricher:8003"), Icon: "⊕"},
		{Name: "persister", URL: env("PERSISTER_URL", "http://persister:8004"), Icon: "💾"},
	}
}

func loadPipelineFromFile() []PipelineService {
	paths := []string{
		getConfigPath(),
		"/app/pipeline.example.yaml",
	}
	if wd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(wd, "..", "pipeline.example.yaml"))
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg pipelineConfig
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			continue
		}
		if len(cfg.Services) > 0 {
			return cfg.Services
		}
	}
	return defaultPipeline()
}

// loadPipelineFromPath reads pipeline from a specific path. Returns nil if read fails or no services.
func loadPipelineFromPath(path string) []PipelineService {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var cfg pipelineConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	if len(cfg.Services) == 0 {
		return nil
	}
	return cfg.Services
}

// LoadPipeline returns the current pipeline (file-authoritative or memory/file).
func LoadPipeline() []PipelineService {
	if fileAuthoritative() {
		path := getWritablePath()
		if path == "" {
			path = getConfigPath()
		}
		configMu.Lock()
		defer configMu.Unlock()
		info, err := os.Stat(path)
		if err == nil && !info.ModTime().After(fileCacheMtime) && fileCachePath == path && len(fileCache) > 0 {
			out := make([]PipelineService, len(fileCache))
			copy(out, fileCache)
			return out
		}
		svc := loadPipelineFromPath(path)
		if svc != nil {
			fileCache = svc
			fileCachePath = path
			if info != nil {
				fileCacheMtime = info.ModTime()
			}
			out := make([]PipelineService, len(svc))
			copy(out, svc)
			return out
		}
		// Fallback to read-only paths
		fileCache = nil
		fileCachePath = ""
		svc = loadPipelineFromFile()
		out := make([]PipelineService, len(svc))
		copy(out, svc)
		return out
	}

	configMu.RLock()
	if configMemory != nil {
		out := make([]PipelineService, len(configMemory))
		copy(out, configMemory)
		configMu.RUnlock()
		return out
	}
	configMu.RUnlock()

	configMu.Lock()
	defer configMu.Unlock()
	if configMemory == nil {
		configMemory = loadPipelineFromFile()
	}
	out := make([]PipelineService, len(configMemory))
	copy(out, configMemory)
	return out
}

// SetPipeline sets the in-memory pipeline and optionally writes to WRITABLE_PIPELINE_PATH.
// When file-authoritative (WRITABLE_PIPELINE_PATH set), writes to file and invalidates cache so next LoadPipeline reads from file.
func SetPipeline(services []PipelineService) error {
	path := getWritablePath()
	if path != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		cfg := pipelineConfig{Services: services}
		data, err := yaml.Marshal(&cfg)
		if err != nil {
			return err
		}
		if err := os.WriteFile(path, data, 0644); err != nil {
			return err
		}
		configMu.Lock()
		fileCache = nil
		fileCachePath = ""
		configMu.Unlock()
		return nil
	}

	configMu.Lock()
	configMemory = services
	configMu.Unlock()
	return nil
}

// NormalizeURL ensures URL has a scheme.
func NormalizeURL(url string) string {
	url = strings.TrimSpace(url)
	if url == "" {
		return url
	}
	if !strings.Contains(url, "://") {
		return "http://" + url
	}
	return url
}

// PipelineNamesURLs returns (name, url) pairs for the current pipeline.
func PipelineNamesURLs() [][2]string {
	svc := LoadPipeline()
	out := make([][2]string, len(svc))
	for i := range svc {
		out[i] = [2]string{svc[i].Name, svc[i].URL}
	}
	return out
}
