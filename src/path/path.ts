export function clean(path: string): string {
	if (path === '') return '.'

	const rooted = path[0] === '/'
	const n = path.length

	// let rst = ''
	let [r, dotdot, out] = rooted ? [1, 1, '/'] : [0, 0, '']
	while (r < n) {
		const c = path[r]
		if (c === '/') {
			// empty path element
			r++
			continue
		}
		if (c === '.') {
			if (r + 1 === n || path[r + 1] === '/') {
				// . element
				r++
				continue
			}
			if (path[r + 1] === '.' && (r + 2 === n || path[r + 2] === '/')) {
				// .. element: remove to last /
				r += 2
				if (out.length > dotdot) {
					// can backtrack
					const pos = out.lastIndexOf('/')
					out = out.slice(0, Math.max(dotdot, pos))
					continue
				}
				if (!rooted) {
					// cannot backtrack, but not rooted, so append .. element.
					if (out.length > 0) {
						out += '/'
					}
					out += '..'
					dotdot = out.length
					continue
				}
			}
		}

		// real path element.
		// add slash if needed

		if ((rooted && out.length !== 1) || (!rooted && out.length !== 0)) {
			out += '/'
		}

		const pos = path.indexOf('/', r)
		const elem = path.slice(r, pos > 0 ? pos : undefined)
		r += elem.length
		out += elem
	}

	if (out.length === 0) return '.'
	return out
}

export function split(path: string): [string, string] {
	const pos = path.lastIndexOf('/')
	if (pos < 0) return ['', path]
	return [path.slice(0, pos + 1), path.slice(pos + 1)]
}

export function join(...elems: string[]): string {
	elems = elems.filter(v => v !== '')
	if (elems.length === 0) return ''
	return clean(elems.join('/'))
}

export function base(path: string): string {
	if (path === '') {
		return '.'
	}

	while (path.length > 0 && path.endsWith('/')) {
		path = path.slice(0, -1)
	}

	const pos = path.lastIndexOf('/')
	if (pos >= 0) {
		path = path.slice(pos + 1)
	}
	if (path === '') {
		return '/'
	}

	return path
}

export function dir(path: string): string {
	const [d, _] = split(path)
	return clean(d)
}

export function* entries(path: string): Iterable<[string, string]> {
	if (path.length === 0) return

	let pos = path[0] === '/' ? 1 : 0
	while (pos < path.length) {
		const next = path.indexOf('/', pos)
		if (next < 0) {
			return yield [path.slice(pos), '']
		}

		const curr = path.slice(pos, next)
		const rest = path.slice(next + 1)
		yield [curr, rest]
		pos = next + 1
	}
}
