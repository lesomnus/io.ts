# io

Provides a Golang `io`-like I/O interface with a JS stream API wrapper.

## Usage

```ts
import io from '@lesomnus/io'

io.fetch('http://worldtimeapi.org/api/timezone/Asia/Seoul').then(async r => {
	const b = io.make(512)
	const n = await io.readFull(r, b)
	if (n === null) {
		console.error(r)
		throw new Error('what is wrong?')
	}

	const body = new TextDecoder().decode(b.subarray(0, n).data)
	console.log(body)
	// {"abbreviation":"KST","datetime":"2024-02-27T01:09:43.098317+09:00" ...
})
```
