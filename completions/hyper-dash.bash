# Bash completion for hyper-dash

_hyper_dash_completion() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    opts="dash help version test"

    # Subcommands for dash
    dash_opts="--mode --epic --verbose --debug --config --help"

    # Mode options
    mode_opts="basic advanced performance debug"

    case "${prev}" in
        hyper-dash)
            COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
            return 0
            ;;
        dash)
            COMPREPLY=( $(compgen -W "${dash_opts}" -- ${cur}) )
            return 0
            ;;
        --mode|-m)
            COMPREPLY=( $(compgen -W "${mode_opts}" -- ${cur}) )
            return 0
            ;;
        --epic|-e)
            # Complete with available epic names from filesystem
            if [ -d ".taskmaster" ]; then
                local epics=$(find .taskmaster -name "*.json" -exec basename {} .json \; 2>/dev/null)
                COMPREPLY=( $(compgen -W "${epics}" -- ${cur}) )
            fi
            return 0
            ;;
        --config|-c)
            # Complete with config file paths
            COMPREPLY=( $(compgen -f -X '!*.json' -- ${cur}) )
            return 0
            ;;
        *)
            ;;
    esac

    # Default completion
    COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
}

complete -F _hyper_dash_completion hyper-dash