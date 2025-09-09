/**
 * Test file to demonstrate API extraction for Hypergen core interfaces
 * @public
 */
/**
 * Core Hypergen engine for template processing
 * @public
 */
export class HypergenEngine {
    config;
    /**
     * Creates a new Hypergen engine
     * @param config - Engine configuration
     */
    constructor(config) {
        this.config = config;
    }
    /**
     * Runs a template generator
     * @param name - Generator name
     * @param action - Action name
     * @param args - Generator arguments
     * @returns Promise resolving when complete
     */
    async run(name, action, args) {
        // Implementation would go here
        console.log(`Running ${name}:${action} with args:`, args);
    }
    /**
     * Gets available generators
     * @returns Array of generator names
     */
    getGenerators() {
        return ['example', 'component', 'api'];
    }
}
//# sourceMappingURL=test-api-extraction.js.map