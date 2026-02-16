export default (type: string, subject: string, start = new Date()) =>
	(status: string, payload: any = null, end = new Date()) => ({
		type,
		subject,
		status,
		timing: end.getTime() - start.getTime(),
		...(payload && { payload }),
	});
