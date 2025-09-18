#compdef hyper-dash

# Zsh completion for hyper-dash

_hyper_dash() {
    local context state line
    typeset -A opt_args

    _arguments -C \
        '1: :_hyper_dash_commands' \
        '*::arg:->args' \
        && return 0

    case $state in
        args)
            case $line[1] in
                dash)
                    _arguments \
                        '(-m --mode)'{-m,--mode}'[Set dashboard mode]:mode:(basic advanced performance debug)' \
                        '(-e --epic)'{-e,--epic}'[Select epic]:epic:_hyper_dash_epics' \
                        '(-v --verbose)'{-v,--verbose}'[Enable verbose output]' \
                        '(-d --debug)'{-d,--debug}'[Enable debug mode]' \
                        '(-c --config)'{-c,--config}'[Config file path]:file:_files -g "*.json"' \
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                help)
                    _hyper_dash_commands
                    ;;
            esac
            ;;
    esac
}

_hyper_dash_commands() {
    local commands=(
        'dash:Start the dashboard TUI'
        'help:Show help information'
        'version:Show version information'
        'test:Run in test mode'
    )
    _describe 'commands' commands
}

_hyper_dash_epics() {
    local epics=()
    if [[ -d ".taskmaster" ]]; then
        epics=(${(f)"$(find .taskmaster -name "*.json" -exec basename {} .json \; 2>/dev/null)"})
    fi
    _describe 'epics' epics
}

_hyper_dash "$@"