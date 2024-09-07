import io from '~/.'
import path from '~/path'

import { Block } from './block'
import { type FileMode, OpenFlag } from './constants'
import * as errs from './errors'
import type { DirEntry, File, FileInfo, Fs, ReadOnlyFile } from './types'

class MemNode {
	mtime = new Date()

	constructor(public mode: FileMode) {}

	get length(): number {
		return 0
	}
}

class MemFileNode extends MemNode {
	mtime = new Date()
	blocks: Uint8Array[] = [new Uint8Array()]

	cntReaders = 0
	cntWriters = 0

	override get length(): number {
		switch (this.blocks.length) {
			case 0:
				return 0

			case 1:
				return this.blocks[0].length

			default: {
				const n = this.blocks.length - 1
				return Block.Size * n + this.blocks[n].length
			}
		}
	}
}

abstract class MemFileBase implements File {
	#op: Promise<void> = Promise.resolve()

	protected closed = false
	protected b: Promise<Block>
	protected curr: number

	constructor(
		protected node: MemFileNode,
		protected name: string,
		atEnd: boolean,
	) {
		this.curr = atEnd ? Math.min(node.blocks.length - 1, 0) : 0
		let b = Promise.resolve(new Block(node.blocks[this.curr]))
		if (atEnd) {
			b = b.then(async b => {
				await b.seek(0, io.Seek.End)
				return b
			})
		}
		this.b = b
	}

	protected advanceBlock(): Block | undefined {
		const next = this.curr + 1
		if (next >= this.node.blocks.length) {
			return undefined
		}

		const b = new Block(this.node.blocks[next])
		this.b = Promise.resolve(b)
		this.curr = next
		return b
	}

	protected do<T>(f: () => Promise<T>): Promise<T> {
		const op = this.#op.then(f)
		this.#op = op.catch(() => {}) as Promise<void>
		return op
	}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: this.node.length,
			modTime: this.node.mtime,
			isDir: false,
		})
	}

	async #read(p: io.Span): Promise<number | null> {
		let o = 0
		while (o < p.length) {
			const b = await this.b
			if (b.available === 0) {
				break
			}

			const n = await b.read(p.subbuff(o))
			if (n === null) {
				throw new Error('invalid state: content of block must be available')
			}

			o += n
			if (b.available === 0) {
				this.advanceBlock()
			}
		}

		if (o === 0) {
			return null
		}
		return o
	}

	read(p: io.Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.do(() => this.#read(p))
	}

	async #write(p: io.Span): Promise<number | null> {
		let o = 0

		let b = await this.b
		let c = b.capacity
		while (true) {
			if (o >= p.length) {
				return o
			}

			const n = await b.write(p.subbuff(o))
			if (n === null) {
				const next = this.advanceBlock()
				if (!next) {
					break
				}

				b = next
				c = next.capacity
				continue
			}
			if (c !== b.capacity) {
				// block is grown so the underlying buffer is changed.
				this.node.blocks[this.curr] = b.data
				c = b.capacity
			}

			o += n
		}

		const isGrown = o < p.length
		while (o < p.length) {
			const end = Math.min(o + Block.Size, p.length)
			const d = p.subbuff(o, end).data
			const b = new Uint8Array(d.length)

			b.set(d)
			this.node.blocks.push(b)

			o += d.length
		}
		if (isGrown) {
			const b = this.node.blocks[this.node.blocks.length - 1]
			this.b = Promise.resolve(new Block(b))
		}

		return o
	}

	write(p: io.Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.do(() => this.#write(p))
	}

	async #seek(offset: number, whence?: io.Seek): Promise<number> {
		const end = this.node.length

		let i: number
		switch (whence) {
			case io.Seek.Start:
				i = 0
				break

			case io.Seek.Current: {
				const b = await this.b
				i = Block.Size * this.curr + b.length
				break
			}

			case io.Seek.End:
				i = end
				break

			default:
				throw new Error('unknown whence')
		}

		const o = i + offset
		if (!(0 <= o && o <= end)) {
			throw new Error('out of range')
		}

		const bi = o % Block.Size
		const bo = Math.floor(o / Block.Size)
		const d = this.curr - bi
		if (d !== 0) {
			this.curr = bi
			this.b = Promise.resolve(new Block(this.node.blocks[this.curr]))
		}

		const b = await this.b
		await b.seek(bo, io.Seek.Start)
		return o
	}

	seek(offset: number, whence?: io.Seek): Promise<number> {
		if (this.closed) Promise.reject(new Error('closed'))
		return this.do(() => this.#seek(offset, whence))
	}

	protected abstract onClose(): Promise<void>

	close(): Promise<void> {
		if (this.closed) {
			return this.#op
		}

		this.closed = true
		return this.do(() => this.onClose())
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return this.close()
	}
}

class ReadOnlyMemFile extends MemFileBase {
	override write(p: io.Span): Promise<number | null> {
		return Promise.reject(new Error('read only file'))
	}

	protected override onClose(): Promise<void> {
		this.node.cntReaders--
		return Promise.resolve()
	}
}

class MemFile extends MemFileBase {
	protected override onClose(): Promise<void> {
		this.node.cntReaders--
		this.node.cntWriters--
		return Promise.resolve()
	}
}

class AppendOnlyMemFile extends MemFile {
	constructor(node: MemFileNode, name: string) {
		super(node, name, true)
	}

	override seek(offset: number, whence?: io.Seek): Promise<number> {
		return Promise.resolve(this.node.length)
	}
}

class MemDirNode extends MemNode {
	entries = new Map<string, MemNode>()
}

class MemDir implements File {
	constructor(
		protected node: MemDirNode,
		protected name: string,
	) {}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: 0,
			modTime: this.node.mtime,
			isDir: true,
		})
	}

	read(p: io.Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	write(p: io.Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	seek(offset: number, whence?: io.Seek): Promise<number> {
		return Promise.reject(new errs.ErrDirectory())
	}

	close(): Promise<void> {
		return Promise.resolve()
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return this.close()
	}
}

class MemSymLinkNode extends MemNode {
	constructor(
		mode: FileMode,
		public readonly link: string,
	) {
		super(mode)
	}

	override get length(): number {
		return this.link.length
	}
}

type GetResult<T = MemNode | undefined> = {
	p: MemDirNode // parent directory.
	e: T // entry.
	n: string // name of the entry.
	r: string // rest part of the given path.
}

export class MemFs implements Fs {
	root: MemDirNode = new MemDirNode(0o755 as FileMode)

	#get(name: string, h: MemDirNode[]): Omit<GetResult, 'p'> {
		// expect `name` to be clean.
		let e = h.pop() as MemDirNode // current visiting entry.
		let n = '' // name of `e`.
		let r: string | undefined = name
		for ([n, r] of path.entries(name)) {
			if (n === '..') {
				if (h.length > 0) {
					e = h.pop() as MemDirNode
				}
				continue
			}

			const next = e.entries.get(n)
			if (!(next instanceof MemDirNode)) {
				if (!next) {
					h.push(e)
				}
				return { e: next, n, r }
			}

			h.push(e)
			e = next
		}

		return { e, n, r }
	}

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
		while (true) {
			const rst = this.#get(name, h)
			const { e, r } = rst
			if (e instanceof MemSymLinkNode) {
				name = path.join(e.link, r)
				continue
			}

			return { ...rst, p: h[h.length - 1] ?? this.root }
		}
	}

	private getX(name: string): Omit<GetResult<MemNode>, 'r'> {
		const rst = this.get(name)
		const { e, r } = rst
		if (r !== '') {
			throw new errs.ErrNotDirectory()
		}
		if (!e) {
			throw new errs.ErrNotExist()
		}

		return { ...rst, e }
	}

	open(name: string): Promise<ReadOnlyFile> {
		return this.openFile(name, OpenFlag.Read, 0 as FileMode)
	}

	async openFile(name: string, flag: OpenFlag, mode?: FileMode): Promise<File> {
		if (flag === OpenFlag.Unspecified) {
			flag = OpenFlag.Read
		}

		const { p, e, n, r } = this.get(name)
		if (r !== '') {
			throw new errs.ErrNotDirectory()
		}
		if (e instanceof MemDirNode) {
			if ((flag & (OpenFlag.Write | OpenFlag.Trunc)) > 0) {
				throw new errs.ErrDirectory()
			}
			return new MemDir(e, n)
		}
		if (!e && (flag & OpenFlag.Read) > 0) {
			throw new errs.ErrNotExist()
		}
		if (!e || e instanceof MemFileNode) {
			const atEnd = (flag & OpenFlag.AtEnd) > 0
			const wFlag = flag & (OpenFlag.Write | OpenFlag.Append | OpenFlag.Trunc)

			let node = e
			if (node) {
				if (node.cntWriters > 0 && wFlag !== OpenFlag.Write) {
					throw new errs.ErrBusy()
				}

				const x = OpenFlag.Write | OpenFlag.NoReplace
				if ((flag & x) === x) {
					throw new errs.ErrExist()
				}

				if (wFlag === 0) {
					node.cntReaders++
					return new ReadOnlyMemFile(node, n, atEnd)
				}
			}

			if (!node || (flag & OpenFlag.Read) === 0) {
				node = new MemFileNode(mode ?? (0o644 as FileMode))
				p.entries.set(n, node)
			}

			node.cntReaders++
			node.cntWriters++
			if ((flag & OpenFlag.Trunc) > 0) {
				node.blocks = [new Uint8Array()]
			}
			if ((flag & OpenFlag.Append) > 0) {
				return new AppendOnlyMemFile(node, n)
			}

			return new MemFile(node, n, atEnd)
		}

		throw new Error('invalid state: unknown type of node')
	}

	async *readDir(name: string): AsyncIterable<DirEntry> {
		const { e } = this.getX(name)
		if (!(e instanceof MemDirNode)) {
			throw new errs.ErrNotDirectory()
		}

		for (const [n, node] of e.entries) {
			const isDir = node instanceof MemDirNode
			yield {
				name: n,
				isDir,
				info: () =>
					Promise.resolve({
						name: n,
						isDir,
						modTime: node.mtime,
						size: node.length,
					}),
			}
		}
	}

	async stat(name: string): Promise<FileInfo> {
		const { e, n } = this.getX(name)

		return {
			name: n,
			isDir: e instanceof MemDirNode,
			modTime: e.mtime,
			size: e.length,
		}
	}

	create(name: string): Promise<File> {
		return this.openFile(name, OpenFlag.Write | OpenFlag.Trunc)
	}

	mkdir(name: string, mode?: FileMode): Promise<void> {
		const { p, e, n, r } = this.get(name)
		if (r !== '') {
			return Promise.reject(new errs.ErrNotDirectory())
		}
		if (e !== undefined) {
			return Promise.reject(new errs.ErrExist())
		}

		const node = new MemDirNode(mode ?? (0o755 as FileMode))
		p.entries.set(n, node)
		return Promise.resolve()
	}

	mkdirAll(name: string, mode?: FileMode): Promise<void> {
		const { p, e, n, r } = this.get(name)
		if (e) {
			if (!(e instanceof MemDirNode)) {
				return Promise.reject(new errs.ErrNotDirectory())
			}
			if (r === '') {
				return Promise.resolve()
			}
		}

		let d = new MemDirNode(mode ?? (0o755 as FileMode))
		for (const [n] of path.entriesReverse(r)) {
			const next = new MemDirNode(mode ?? (0o755 as FileMode))
			next.entries.set(n, d)
			d = next
		}

		p.entries.set(n, d)
		return Promise.resolve()
	}

	async rename(oldname: string, newname: string): Promise<void> {
		const a = this.getX(oldname)
		const b = this.get(newname)
		if (b.r !== '') {
			throw new errs.ErrNotDirectory()
		}

		if (a.e === b.e) {
			// Same file.
			return
		}

		if (a.e instanceof MemFileNode) {
			if (b.e instanceof MemDirNode) {
				throw new errs.ErrDirectory()
			}
		} else {
			// `a.e` instanceof `MemDirNode`
			if (b.e instanceof MemDirNode && b.e.entries.size !== 0) {
				throw new errs.ErrDirectoryNotEmpty()
			}
			if (b.e instanceof MemFileNode) {
				throw new errs.ErrNotDirectory()
			}
		}

		a.p.entries.delete(a.n)
		b.p.entries.set(b.n, a.e)
		return
	}

	async remove(name: string): Promise<void> {
		const { p, e, n } = this.getX(name)
		if (e instanceof MemDirNode && e.entries.size !== 0) {
			throw new errs.ErrDirectoryNotEmpty()
		}

		p.entries.delete(n)
	}
}
