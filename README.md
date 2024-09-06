# io

Provides a Golang `io`-like I/O interface with a JS stream API wrapper.

## Usage

```ts
import io from '@lesomnus/io'

fetch('http://worldtimeapi.org/api/timezone/Asia/Seoul').then(async res => {
	const r = io.fromReadableStream(res.body)
	const b = io.make(512)
	const n = await io.readFull(r, b)

	const body = new TextDecoder().decode(b.subarray(0, n).data)
	console.log(body)
	// {"abbreviation":"KST","datetime":"2024-02-27T01:09:43.098317+09:00" ...
})
```
