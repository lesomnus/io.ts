import * as io from '@lesomnus/io'

const fileInput = document.getElementById('fileInput')
if (fileInput === null) {
	throw new Error('#fileInput not found')
}

fileInput.addEventListener('change', onFile)

async function onFile(this: HTMLInputElement, evt: Event) {
	if (this.files === null || this.files?.length === 0) {
		return
	}

	const f = this.files[0]
	const r = io.fromReadableStream(f.stream())
	const s = io.Buff.make(12)
	for await (const n of io.gulp(r, s)) {
		console.log([...s.subarray(0, n)])
	}
}
