import io from '~/.'
import type { Span } from '~/Buff'
import path, { entries } from '~/path'

import { type FileMode, OpenFlag } from './constants'
import * as errs from './errors'
import type { DirEntry, File, FileInfo, Fs, ReadOnlyFile } from './types'

class Block extends io.Buff {
	mtime = new Date()
	cntReaders = 0
	cntWriters = 0

	constructor() {
		super(new Uint8Array(512), 0, 0)
	}

	override write(p: Span): Promise<number | null> {
		this.mtime = new Date()
		return super.write(p)
	}
}

abstract class MemFileBase implements File {
	protected closed = false

	constructor(
		protected block: Block,
		public name: string,
	) {}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: this.block.length,
			modTime: this.block.mtime,
			isDir: false,
		})
	}

	abstract read(p: Span): Promise<number | null>

	abstract write(p: Span): Promise<number | null>

	close(): Promise<void> {
		this.closed = true
		return Promise.resolve()
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return this.close()
	}
}

class ReadOnlyMemFile extends MemFileBase implements File {
	private buff: io.Buff

	constructor(block: Block, name: string) {
		if (block.cntWriters > 0) {
			throw new errs.ErrBusy()
		}
		super(block, name)
		block.cntReaders++
		this.buff = block.subbuff(0)
	}

	read(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.buff.read(p)
	}

	write(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return Promise.reject(new errs.ErrReadOnly())
	}

	close(): Promise<void> {
		this.closed = true
		this.block.cntReaders--
		return Promise.resolve()
	}
}

class MemFile extends MemFileBase implements File {
	constructor(block: Block, name: string) {
		if (block.cntReaders > 0) {
			throw new errs.ErrBusy()
		}
		super(block, name)
		block.cntReaders++
		block.cntWriters++
	}

	read(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.block.read(p)
	}

	write(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.block.write(p)
	}

	close(): Promise<void> {
		this.closed = true
		this.block.cntReaders--
		this.block.cntWriters--
		return Promise.resolve()
	}
}

class Dir extends Map<string, Dir | Block | string> {
	mtime = new Date()
}

class MemDir implements File {
	constructor(
		private dir: Dir,
		public name: string,
	) {}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: 0,
			modTime: this.dir.mtime,
			isDir: true,
		})
	}

	read(p: io.Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	write(p: io.Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	close(): Promise<void> {
		return Promise.resolve()
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return this.close()
	}
}

type GetResult = {
	p: Dir // parent directory.
	e: Dir | Block | undefined // entry.
	n: string // name of the entry.
	r: string // rest part of the given path.
}

export class MemFs implements Fs {
	root: Dir = new Dir()

	private get_(name: string, h: Dir[]): Omit<GetResult, 'p'> {
		// expect `name` to be clean.
		let e: Dir | Block | undefined = h.pop() as Dir // current visiting entry.
		let n = '' // name of `e`.
		let r: string | undefined = name
		for ([n, r] of path.entries(name)) {
			if (e instanceof Block) {
				throw new errs.ErrNotDirectory()
			}
			if (n === '..') {
				if (h.length > 0) {
					e = h.pop() as Dir
				}
				continue
			}

			const next = e.get(n)
			if (next === undefined) {
				return { e: undefined, n, r }
			}
			if (next instanceof Dir) {
				h.push(next)
				e = next
				continue
			}
			if (next instanceof Block) {
				e = next
				continue
			}

			h.push(e)
			;({ e, n } = this.get_(next, h))
			if (e === undefined) {
				throw new Error('broken link')
			}
		}

		if (e instanceof Dir) {
			h.pop()
		}
		return { e, n, r }
	}

	// returns: entry of given name, basename of the entry, and the parent directory of the entry.
	private get(name: string): GetResult {
		name = path.clean(name)
		if (name === '.') {
			return {
				p: this.root,
				e: this.root,
				n: '/',
				r: name,
			}
		}

		const h = [this.root]
		const rst = this.get_(name, h)
		return {
			...rst,
			p: h[h.length - 1] ?? this.root,
		}
	}

	async open(name: string): Promise<ReadOnlyFile> {
		return this.openFile(name, OpenFlag.Read, 0 as FileMode)
	}

	async openFile(name: string, flag: OpenFlag, mode: FileMode): Promise<File> {
		const { p, e, n } = this.get(name)
		if (e instanceof Dir) {
			if ((flag & (OpenFlag.Write | OpenFlag.Trunc)) > 0) {
				throw new errs.ErrDirectory()
			}
			return new MemDir(e, n)
		}
		if (e instanceof Block) {
			const x = OpenFlag.Write | OpenFlag.NoReplace
			if ((flag & x) === x) {
				throw new errs.ErrExist()
			}
			if ((flag & (OpenFlag.Write | OpenFlag.Trunc)) === 0) {
				return new ReadOnlyMemFile(e, n)
			}
			if ((flag & (OpenFlag.Append | OpenFlag.Trunc)) === 0) {
				const b = new Block()
				p.set(n, b)

				const f = new MemFile(b, n)
				return f
			}

			// Note that the block is stored in append-ready state.
			const f = new MemFile(e, n)
			if ((flag & OpenFlag.Trunc) > 0) {
				// TODO: move offset to 0.
				e.truncate(0)
			}
			return f
		}
		if ((flag & OpenFlag.Write) === 0) {
			throw new errs.ErrNotExist()
		}

		const b = new Block()
		p.set(n, b)

		const f = new MemFile(b, n)
		return f
	}

	async *readDir(name: string): AsyncIterable<DirEntry> {
		const { e, r } = this.get(name)
		if (r !== '') {
			throw new errs.ErrNotDirectory()
		}
		if (e === undefined) {
			throw new errs.ErrNotExist()
		}
		if (e instanceof Block) {
			throw new errs.ErrNotDirectory()
		}

		for (const [n, e_] of e) {
			if (e_ instanceof Dir) {
				const f = new MemDir(e_, n)
				yield {
					name: n,
					isDir: true,
					info: () => f.stat(),
				}
				continue
			}
			if (e_ instanceof Block) {
				yield {
					name: n,
					isDir: false,
					info: () =>
						Promise.resolve({
							name: n,
							isDir: false,
							modTime: e_.mtime,
							size: e_.length,
						}),
				}
				// continue
			}

			// TODO: `e_` is a link.
		}
	}

	async stat(name: string): Promise<FileInfo> {
		const { e, n } = this.get(name)
		if (e === undefined) {
			throw new errs.ErrNotExist()
		}
		return e instanceof Block
			? {
					name: n,
					size: e.length,
					modTime: e.mtime,
					isDir: false,
				}
			: {
					name: n,
					size: 0,
					modTime: e.mtime,
					isDir: true,
				}
	}

	async create(name: string): Promise<File> {
		return this.openFile(name, OpenFlag.Write | OpenFlag.Trunc, 0 as FileMode)
	}

	async mkdir(name: string, mode: FileMode): Promise<void> {
		const { p, e, n } = this.get(name)
		if (e !== undefined) {
			throw new errs.ErrExist()
		}

		const f = new Dir()
		p.set(n, f)
	}

	async mkdirAll(name: string, mode: FileMode): Promise<void> {
		const { p, e, n, r } = this.get(name)
		if (e instanceof Dir) return
		if (e instanceof Block) {
			throw new errs.ErrNotDirectory()
		}

		const d = new Dir()
		p.set(n, d)

		let prev = d
		for (const [n] of entries(r)) {
			const d = new Dir()
			prev.set(n, d)
			prev = d
		}
	}

	async rename(oldname: string, newname: string): Promise<void> {
		const a = this.get(oldname)
		if (a.e === undefined) {
			throw new errs.ErrNotExist()
		}

		const b = this.get(newname)
		if (b.r !== '') {
			throw new errs.ErrNotDirectory()
		}

		// Same file.
		if (a.e === b.e) return

		if (a.e instanceof Block) {
			if (b.e instanceof Dir) {
				throw new errs.ErrDirectory()
			}
		} else {
			// `a.e` instanceof `Dir`
			if (b.e instanceof Dir && b.e.size !== 0) {
				throw new errs.ErrDirectoryNotEmpty()
			}
			if (b.e instanceof Block) {
				throw new errs.ErrNotDirectory()
			}
		}

		b.p.set(b.n, a.e)
		a.p.delete(a.n)
		return
	}

	async remove(name: string): Promise<void> {
		const { p, e, n, r } = this.get(name)
		if (e instanceof Dir && e.size !== 0) {
			throw new errs.ErrDirectoryNotEmpty()
		}
		if (r !== '') {
			throw new errs.ErrNotDirectory()
		}
		if (e === undefined) {
			throw new errs.ErrNotExist()
		}

		p.delete(n)
	}
}
