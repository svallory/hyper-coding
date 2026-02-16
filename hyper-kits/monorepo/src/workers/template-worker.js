const { parentPort } = require("node:worker_threads");

parentPort.on("message", async (task) => {
	try {
		// Simulate template processing work
		await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50));

		parentPort.postMessage({
			taskId: task.id,
			success: true,
		});
	} catch (error) {
		parentPort.postMessage({
			taskId: task.id,
			success: false,
			error: error.message,
		});
	}
});
