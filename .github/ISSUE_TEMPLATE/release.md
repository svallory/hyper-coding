---
name: Release
about: Create a release issue for tracking release preparation
title: 'Release v[VERSION]'
labels: 'release, CI/CD'
assignees: ''

---

## Release Checklist v[VERSION]

### Pre-Release
- [ ] All planned features/fixes are merged
- [ ] Version number updated in relevant files
- [ ] CHANGELOG.md updated with release notes
- [ ] All CI/CD checks are passing
- [ ] Cross-platform builds are working
- [ ] Documentation is up to date

### Testing
- [ ] Manual testing on all platforms
- [ ] Performance regression testing
- [ ] Integration tests passing
- [ ] Security scans completed

### Release Process
- [ ] Create release tag (`git tag v[VERSION]`)
- [ ] Push tag to trigger release workflow
- [ ] Verify GitHub release creation
- [ ] Check all artifacts are uploaded
- [ ] Verify Docker images are built and pushed
- [ ] Test installation on all platforms

### Post-Release
- [ ] Announce release
- [ ] Update installation documentation
- [ ] Monitor for issues
- [ ] Update package managers (Homebrew, Scoop, etc.)

### Release Notes

#### New Features
- [ ] Feature 1
- [ ] Feature 2

#### Bug Fixes
- [ ] Fix 1
- [ ] Fix 2

#### Performance Improvements
- [ ] Improvement 1

#### Breaking Changes
- [ ] Change 1 (if any)

### Installation Testing

#### Package Managers
- [ ] Homebrew (macOS/Linux)
- [ ] Scoop (Windows)
- [ ] APT (Debian/Ubuntu)
- [ ] YUM/DNF (RHEL/Fedora)

#### Direct Download
- [ ] Linux amd64
- [ ] Linux arm64
- [ ] macOS amd64
- [ ] macOS arm64 (Apple Silicon)
- [ ] Windows amd64

#### Docker
- [ ] Docker Hub
- [ ] GitHub Container Registry

### Sign-off
- [ ] Release approved by maintainers
- [ ] All checks completed
- [ ] Ready for release