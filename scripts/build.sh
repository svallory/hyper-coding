#!/bin/bash
set -e

# HyperDash Cross-platform Build Script
# This script builds HyperDash for multiple platforms

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/apps/dash"
DIST_DIR="$APP_DIR/dist"

# Configuration
GO_VERSION="1.24.3"
APP_NAME="hyper-dash"
VERSION=${VERSION:-"dev"}
COMMIT=${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")}
DATE=${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}

# Platform configurations
PLATFORMS=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v go &> /dev/null; then
        log_error "Go is not installed or not in PATH"
        exit 1
    fi
    
    GO_VERSION_INSTALLED=$(go version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
    if [[ "$GO_VERSION_INSTALLED" != "$GO_VERSION" ]]; then
        log_warning "Go version mismatch. Expected: $GO_VERSION, Found: $GO_VERSION_INSTALLED"
    fi
    
    if ! command -v git &> /dev/null; then
        log_warning "Git is not installed. Version info may be incomplete."
    fi
    
    log_success "Prerequisites check completed"
}

# Clean previous builds
clean_build() {
    log_info "Cleaning previous builds..."
    rm -rf "$DIST_DIR"
    mkdir -p "$DIST_DIR"
    log_success "Build directory cleaned"
}

# Build for specific platform
build_platform() {
    local platform=$1
    local goos=$(echo $platform | cut -d'/' -f1)
    local goarch=$(echo $platform | cut -d'/' -f2)
    
    log_info "Building for $goos/$goarch..."
    
    cd "$APP_DIR"
    
    # Set output name
    local output_name="$APP_NAME-$goos-$goarch"
    if [[ "$goos" == "windows" ]]; then
        output_name="${output_name}.exe"
    fi
    
    # Build flags
    local ldflags="-s -w"
    ldflags="$ldflags -X main.version=$VERSION"
    ldflags="$ldflags -X main.commit=$COMMIT"
    ldflags="$ldflags -X main.date=$DATE"
    ldflags="$ldflags -X main.builtBy=build-script"
    
    # Set environment and build
    export GOOS=$goos
    export GOARCH=$goarch
    export CGO_ENABLED=0
    
    go build \
        -ldflags="$ldflags" \
        -trimpath \
        -mod=readonly \
        -o "$DIST_DIR/$output_name" \
        ./cmd/dash
    
    if [[ $? -eq 0 ]]; then
        local file_size=$(du -h "$DIST_DIR/$output_name" | cut -f1)
        log_success "Built $output_name ($file_size)"
        
        # Create compressed archive
        cd "$DIST_DIR"
        if [[ "$goos" == "windows" ]]; then
            zip "${output_name%.exe}.zip" "$output_name"
        else
            tar -czf "${output_name}.tar.gz" "$output_name"
        fi
        
        cd "$APP_DIR"
    else
        log_error "Failed to build for $goos/$goarch"
        return 1
    fi
}

# Build all platforms
build_all() {
    log_info "Starting cross-platform build..."
    
    local success_count=0
    local total_count=${#PLATFORMS[@]}
    
    for platform in "${PLATFORMS[@]}"; do
        if build_platform "$platform"; then
            ((success_count++))
        fi
    done
    
    log_info "Build summary: $success_count/$total_count platforms built successfully"
    
    if [[ $success_count -eq $total_count ]]; then
        log_success "All platforms built successfully!"
    else
        log_warning "Some platforms failed to build"
        return 1
    fi
}

# Generate checksums
generate_checksums() {
    log_info "Generating checksums..."
    
    cd "$DIST_DIR"
    
    # Generate SHA256 checksums
    if command -v sha256sum &> /dev/null; then
        sha256sum * > checksums.txt
    elif command -v shasum &> /dev/null; then
        shasum -a 256 * > checksums.txt
    else
        log_warning "No checksum utility found"
        return 1
    fi
    
    log_success "Checksums generated"
}

# Create build info
create_build_info() {
    log_info "Creating build info..."
    
    cat > "$DIST_DIR/build-info.json" << EOF
{
    "version": "$VERSION",
    "commit": "$COMMIT",
    "date": "$DATE",
    "go_version": "$(go version | cut -d' ' -f3)",
    "platforms": [
        $(printf '"%s",' "${PLATFORMS[@]}" | sed 's/,$//')
    ],
    "built_by": "build-script"
}
EOF
    
    log_success "Build info created"
}

# Validate builds
validate_builds() {
    log_info "Validating builds..."
    
    cd "$DIST_DIR"
    
    local validation_errors=0
    
    for file in $APP_NAME-*; do
        if [[ -f "$file" ]] && [[ ! "$file" =~ \.(tar\.gz|zip|txt|json)$ ]]; then
            if [[ ! -x "$file" ]] && [[ ! "$file" =~ \.exe$ ]]; then
                log_error "Binary $file is not executable"
                ((validation_errors++))
            fi
            
            # Check file size (should be > 1MB for Go binaries)
            local file_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null)
            if [[ $file_size -lt 1048576 ]]; then
                log_warning "Binary $file seems too small ($file_size bytes)"
            fi
        fi
    done
    
    if [[ $validation_errors -eq 0 ]]; then
        log_success "All builds validated successfully"
    else
        log_error "$validation_errors validation errors found"
        return 1
    fi
}

# Display build results
display_results() {
    log_info "Build Results:"
    echo
    
    cd "$DIST_DIR"
    
    printf "%-30s %-15s %-15s\n" "File" "Size" "Type"
    printf "%-30s %-15s %-15s\n" "----" "----" "----"
    
    for file in *; do
        if [[ -f "$file" ]]; then
            local size=$(du -h "$file" | cut -f1)
            local type="Binary"
            
            if [[ "$file" =~ \.tar\.gz$ ]]; then
                type="Archive"
            elif [[ "$file" =~ \.zip$ ]]; then
                type="Archive"
            elif [[ "$file" =~ \.txt$ ]]; then
                type="Text"
            elif [[ "$file" =~ \.json$ ]]; then
                type="JSON"
            fi
            
            printf "%-30s %-15s %-15s\n" "$file" "$size" "$type"
        fi
    done
    
    echo
    log_success "Build completed! Artifacts are in: $DIST_DIR"
}

# Main execution
main() {
    log_info "HyperDash Cross-platform Build Script"
    log_info "Version: $VERSION | Commit: $COMMIT | Date: $DATE"
    echo
    
    check_prerequisites
    clean_build
    
    # Change to app directory
    cd "$APP_DIR"
    
    # Download dependencies
    log_info "Downloading Go dependencies..."
    go mod download
    go mod verify
    
    # Run tests first
    if [[ "${SKIP_TESTS:-false}" != "true" ]]; then
        log_info "Running tests..."
        go test ./... || {
            log_error "Tests failed. Aborting build."
            exit 1
        }
        log_success "Tests passed"
    fi
    
    # Build all platforms
    build_all || exit 1
    
    # Post-build steps
    generate_checksums
    create_build_info
    validate_builds || exit 1
    
    # Display results
    display_results
}

# Handle script arguments
case "${1:-}" in
    clean)
        clean_build
        ;;
    check)
        check_prerequisites
        ;;
    single)
        if [[ -z "${2:-}" ]]; then
            log_error "Platform required for single build (e.g., linux/amd64)"
            exit 1
        fi
        check_prerequisites
        clean_build
        cd "$APP_DIR"
        go mod download
        build_platform "$2"
        generate_checksums
        create_build_info
        display_results
        ;;
    *)
        main
        ;;
esac