package version

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"encoding/json"
)

func TestGetVersionInfo(t *testing.T) {
	info := GetVersionInfo()
	
	if info.Version == "" {
		t.Error("Version should not be empty")
	}
	
	if info.BuildTime == "" {
		t.Error("BuildTime should not be empty")
	}
	
	if info.GitCommit == "" {
		t.Error("GitCommit should not be empty")
	}
}

func TestFormatVersionInfo(t *testing.T) {
	formatted := FormatVersionInfo()
	
	if formatted == "" {
		t.Error("Formatted version info should not be empty")
	}
	
	// Should contain version number
	if !contains(formatted, Version) {
		t.Errorf("Formatted version should contain version %s", Version)
	}
}

func TestIsUpdateAvailable(t *testing.T) {
	checker := NewChecker()
	
	tests := []struct {
		name      string
		current   string
		latest    string
		expected  bool
		expectErr bool
	}{
		{
			name:     "Update available",
			current:  "1.0.0",
			latest:   "1.1.0",
			expected: true,
		},
		{
			name:     "No update needed",
			current:  "1.1.0",
			latest:   "1.0.0",
			expected: false,
		},
		{
			name:     "Same version",
			current:  "1.0.0",
			latest:   "1.0.0",
			expected: false,
		},
		{
			name:     "Beta to release",
			current:  "1.0.0-beta.1",
			latest:   "1.0.0",
			expected: true,
		},
		{
			name:     "Version with v prefix",
			current:  "v1.0.0",
			latest:   "v1.1.0",
			expected: true,
		},
		{
			name:      "Invalid current version",
			current:   "invalid",
			latest:    "1.0.0",
			expected:  false,
			expectErr: true,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := checker.isUpdateAvailable(tt.current, tt.latest)
			
			if tt.expectErr {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}
			
			if err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
			
			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestCheckForUpdates(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		release := ReleaseInfo{
			TagName:     "v1.1.0",
			Name:        "Release 1.1.0",
			Body:        "New features and bug fixes",
			PublishedAt: time.Now(),
			HTMLURL:     "https://github.com/hyperdev-io/hyper-dash/releases/tag/v1.1.0",
			Prerelease:  false,
			Draft:       false,
		}
		
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(release)
	}))
	defer server.Close()
	
	checker := &Checker{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		repoURL:    server.URL,
		timeout:    5 * time.Second,
	}
	
	ctx := context.Background()
	updateCheck, err := checker.CheckForUpdates(ctx)
	
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	
	if updateCheck == nil {
		t.Fatal("UpdateCheck should not be nil")
	}
	
	if updateCheck.LatestVersion != "v1.1.0" {
		t.Errorf("Expected latest version v1.1.0, got %s", updateCheck.LatestVersion)
	}
	
	if updateCheck.Release == nil {
		t.Error("Release info should not be nil")
	}
}

func TestCheckForUpdatesTimeout(t *testing.T) {
	// Create server that delays response
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	
	checker := &Checker{
		httpClient: &http.Client{Timeout: 100 * time.Millisecond},
		repoURL:    server.URL,
		timeout:    100 * time.Millisecond,
	}
	
	ctx := context.Background()
	_, err := checker.CheckForUpdates(ctx)
	
	if err == nil {
		t.Error("Expected timeout error")
	}
}

func TestCheckForUpdatesWithDraftRelease(t *testing.T) {
	// Create mock server that returns a draft release
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		release := ReleaseInfo{
			TagName:     "v1.1.0",
			Name:        "Draft Release 1.1.0",
			Body:        "Draft release notes",
			PublishedAt: time.Now(),
			HTMLURL:     "https://github.com/hyperdev-io/hyper-dash/releases/tag/v1.1.0",
			Prerelease:  false,
			Draft:       true, // This is a draft release
		}
		
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(release)
	}))
	defer server.Close()
	
	checker := &Checker{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		repoURL:    server.URL,
		timeout:    5 * time.Second,
	}
	
	ctx := context.Background()
	updateCheck, err := checker.CheckForUpdates(ctx)
	
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	
	// Should not show update available for draft releases
	if updateCheck.UpdateAvailable {
		t.Error("Should not show update available for draft releases")
	}
}

func TestFormatUpdateNotification(t *testing.T) {
	checker := NewChecker()
	
	updateCheck := &UpdateCheck{
		UpdateAvailable: true,
		CurrentVersion:  "1.0.0",
		LatestVersion:   "1.1.0",
		ReleaseNotes:    "Bug fixes and improvements",
		DownloadURL:     "https://github.com/hyperdev-io/hyper-dash/releases/tag/v1.1.0",
		CheckedAt:       time.Now(),
		Release: &ReleaseInfo{
			TagName: "v1.1.0",
			Name:    "Release 1.1.0",
			Body:    "Bug fixes and improvements",
		},
	}
	
	notification := checker.FormatUpdateNotification(updateCheck)
	
	if notification == "" {
		t.Error("Notification should not be empty when update is available")
	}
	
	// Should contain version information
	if !contains(notification, "1.0.0") {
		t.Error("Notification should contain current version")
	}
	
	if !contains(notification, "1.1.0") {
		t.Error("Notification should contain latest version")
	}
	
	// Test with no update available
	updateCheck.UpdateAvailable = false
	notification = checker.FormatUpdateNotification(updateCheck)
	
	if notification != "" {
		t.Error("Notification should be empty when no update is available")
	}
}

func TestShouldCheckForUpdates(t *testing.T) {
	now := time.Now()
	frequency := 24 * time.Hour
	
	tests := []struct {
		name      string
		lastCheck time.Time
		expected  bool
	}{
		{
			name:      "Should check - never checked",
			lastCheck: time.Time{},
			expected:  true,
		},
		{
			name:      "Should check - old check",
			lastCheck: now.Add(-25 * time.Hour),
			expected:  true,
		},
		{
			name:      "Should not check - recent check",
			lastCheck: now.Add(-1 * time.Hour),
			expected:  false,
		},
		{
			name:      "Should check - exactly at frequency",
			lastCheck: now.Add(-24 * time.Hour),
			expected:  true,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ShouldCheckForUpdates(tt.lastCheck, frequency)
			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestCheckUpdateFrequency(t *testing.T) {
	frequency := CheckUpdateFrequency()
	expected := 24 * time.Hour
	
	if frequency != expected {
		t.Errorf("Expected frequency %v, got %v", expected, frequency)
	}
}

func TestBuildDownloadURL(t *testing.T) {
	checker := NewChecker()
	version := "v1.1.0"
	
	url := checker.buildDownloadURL(version)
	
	if url == "" {
		t.Error("Download URL should not be empty")
	}
	
	expectedSubstring := "v1.1.0"
	if !contains(url, expectedSubstring) {
		t.Errorf("URL should contain version %s", expectedSubstring)
	}
}

// Helper function to check if a string contains a substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && 
		   (len(substr) == 0 || s[indexAt(s, substr)] == substr[0])
}

func indexAt(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}