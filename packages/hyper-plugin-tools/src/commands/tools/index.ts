import { Command } from '@oclif/core'

export default class ToolsIndexCommand extends Command {
  static description = 'Configure and manage development tools for AI agents'

  static examples = [
    '<%= config.bin %> <%= command.id %> --help',
    '<%= config.bin %> <%= command.id %> ai --list',
    '<%= config.bin %> <%= command.id %> security --install',
    '<%= config.bin %> <%= command.id %> quality --configure',
    '<%= config.bin %> <%= command.id %> architecture --status',
  ]

  async run(): Promise<void> {
    this.log('HyperDev Tools - Swiss Army Knife for AI Agent Development')
    this.log('')
    this.log('Available tool categories:')
    this.log('')
    this.log('  ai           - AI integration tools (MCP servers, agent definitions, Claude Code commands)')
    this.log('  security     - Security tools (dependency scanners, secret scanners, SAST)')
    this.log('  quality      - Code quality tools (linters, formatters, type checkers, tests, CI/CD)')
    this.log('  architecture - Architecture tools (complexity scanners, arch testing, ADR tools)')
    this.log('')
    this.log('Use "hyper tools <category> --help" for more information on a specific category.')
    this.log('')
    this.log('The tools command automates the laborious task of setting up and configuring')
    this.log('all the tools for your project, giving AI agents the same advantages that')
    this.log('developers have through IDE integrations and automated tooling.')
  }
}
