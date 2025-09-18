package version

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
	"strings"
	"github.com/Masterminds/semver/v3"
)

// Version information
const (
	Version   = "1.0.0-beta.1"
	BuildTime = "2025-01-16T12:00:00Z"
	GitCommit = "dev"
)

// VersionInfo contains version and build information
type VersionInfo struct {
	Version   string `json:"version"`
	BuildTime string `json:"build_time"`
	GitCommit string `json:"git_commit"`
	GoVersion string `json:"go_version"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
}

// ReleaseInfo contains information about a GitHub release
type ReleaseInfo struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	PublishedAt time.Time `json:"published_at"`
	HTMLURL     string    `json:"html_url"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
}

// UpdateCheck contains update availability information
type UpdateCheck struct {
	UpdateAvailable bool         `json:"update_available"`
	CurrentVersion  string       `json:"current_version"`
	LatestVersion   string       `json:"latest_version"`
	ReleaseNotes    string       `json:"release_notes"`
	DownloadURL     string       `json:"download_url"`
	CheckedAt       time.Time    `json:"checked_at"`
	Release         *ReleaseInfo `json:"release,omitempty"`
}

// Checker handles version checking and update notifications
type Checker struct {
	httpClient *http.Client
	repoURL    string
	timeout    time.Duration
}

// NewChecker creates a new version checker
func NewChecker() *Checker {
	return &Checker{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		repoURL: "https://api.github.com/repos/hyperdev-io/hyper-dash/releases/latest",
		timeout: 10 * time.Second,
	}
}

// GetVersionInfo returns current version information
func GetVersionInfo() VersionInfo {
	return VersionInfo{
		Version:   Version,
		BuildTime: BuildTime,
		GitCommit: GitCommit,
	}
}

// CheckForUpdates checks if a new version is available
func (c *Checker) CheckForUpdates(ctx context.Context) (*UpdateCheck, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", c.repoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", fmt.Sprintf("hyper-dash/%s", Version))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch release info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var release ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Skip draft releases
	if release.Draft {
		return &UpdateCheck{
			UpdateAvailable: false,
			CurrentVersion:  Version,
			LatestVersion:   Version,
			CheckedAt:       time.Now(),
		}, nil
	}

	updateAvailable, err := c.isUpdateAvailable(Version, release.TagName)
	if err != nil {
		return nil, fmt.Errorf("failed to compare versions: %w", err)
	}

	downloadURL := c.buildDownloadURL(release.TagName)

	return &UpdateCheck{
		UpdateAvailable: updateAvailable,
		CurrentVersion:  Version,
		LatestVersion:   release.TagName,
		ReleaseNotes:    release.Body,
		DownloadURL:     downloadURL,
		CheckedAt:       time.Now(),
		Release:         &release,
	}, nil
}

// isUpdateAvailable compares current version with latest version
func (c *Checker) isUpdateAvailable(current, latest string) (bool, error) {
	// Clean version strings (remove 'v' prefix if present)
	current = strings.TrimPrefix(current, "v")
	latest = strings.TrimPrefix(latest, "v")

	currentVer, err := semver.NewVersion(current)
	if err != nil {
		return false, fmt.Errorf("invalid current version: %w", err)
	}

	latestVer, err := semver.NewVersion(latest)
	if err != nil {
		return false, fmt.Errorf("invalid latest version: %w", err)
	}

	return latestVer.GreaterThan(currentVer), nil
}

// buildDownloadURL constructs the download URL for the latest release
func (c *Checker) buildDownloadURL(version string) string {
	// This would be constructed based on the actual release assets
	// For now, return the GitHub releases page
	return fmt.Sprintf("https://github.com/hyperdev-io/hyper-dash/releases/tag/%s", version)
}

// FormatVersionInfo returns a formatted string with version information
func FormatVersionInfo() string {
	info := GetVersionInfo()
	return fmt.Sprintf("HyperDash %s\nBuild Time: %s\nCommit: %s", 
		info.Version, info.BuildTime, info.GitCommit)
}

// FormatUpdateNotification returns a formatted update notification
func (c *Checker) FormatUpdateNotification(update *UpdateCheck) string {
	if !update.UpdateAvailable {
		return ""
	}

	notification := fmt.Sprintf("🆕 Update Available!\n\n")
	notification += fmt.Sprintf("Current Version: %s\n", update.CurrentVersion)
	notification += fmt.Sprintf("Latest Version: %s\n", update.LatestVersion)
	notification += fmt.Sprintf("Download: %s\n\n", update.DownloadURL)
	
	if update.Release != nil {
		notification += fmt.Sprintf("Release: %s\n", update.Release.Name)
		if update.Release.Body != "" {
			// Truncate release notes if too long
			notes := update.Release.Body
			if len(notes) > 200 {
				notes = notes[:200] + "..."
			}
			notification += fmt.Sprintf("Notes: %s\n", notes)
		}
	}

	notification += "\nUpdate using: npm update -g hyper-dash"
	
	return notification
}

// ShouldCheckForUpdates determines if we should check for updates
// based on the last check time and update frequency
func ShouldCheckForUpdates(lastCheck time.Time, frequency time.Duration) bool {
	return time.Since(lastCheck) >= frequency
}

// CheckUpdateFrequency returns the recommended update check frequency
func CheckUpdateFrequency() time.Duration {
	// Check for updates once per day
	return 24 * time.Hour
}