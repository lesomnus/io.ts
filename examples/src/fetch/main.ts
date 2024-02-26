import * as io from '@lesomnus/io'

io.fetch('http://worldtimeapi.org/api/timezone/Asia/Seoul').then(async r => {
	const b = io.Buff.make(512)
	const n = await io.readFull(r, b)
	if (n === null) {
		console.error(r)
		throw new Error('what is wrong?')
	}

	const body = new TextDecoder().decode(b.subarray(0, n).data)
	console.log(body)
})
