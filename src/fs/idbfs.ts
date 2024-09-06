import io from '~/.'
import type { Span } from '~/Buff'
import path from '~/path'

import { Block } from './block'
import { type FileMode, OpenFlag } from './constants'
import * as errs from './errors'
import type { DirEntry, File, FileInfo, Fs, ReadOnlyFile } from './types'

const NodeStoreName = 'nodes'
const BlockStoreName = 'blocks'
const RootNodeId = 2

export async function newIdbFs(name: string) {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(name, 1)
		req.onsuccess = e => resolve(req.result)
		req.onerror = e => reject(req.error as DOMException)

		req.onupgradeneeded = e => {
			const db = req.result
			const entries = db.createObjectStore(NodeStoreName, {
				keyPath: 'id',
				autoIncrement: true,
			})
			db.createObjectStore(BlockStoreName, { autoIncrement: true })

			entries.add({
				id: 2,
				type: FileType.Directory,
				entries: {},
				mode: 0o755 as FileMode,
				modTime: new Date().getTime(),
			})
		}
	})

	return new IdbFs(db)
}

enum FileType {
	RegularFile = 1,
	Directory = 2,
	SymbolicLink = 7,
}

type Node = {
	id: number
	numLink: number
	mode: FileMode
	modTime: number
} & (
	| {
			type: FileType.RegularFile
			blockIds: number[]
			size: number
			cntReaders: number
			cntWriters: number
	  }
	| {
			type: FileType.Directory
			entries: Partial<Record<string, number>>
	  }
	| {
			type: FileType.SymbolicLink
			value: string
	  }
)
type NodeInput<T extends Node> = Omit<T, 'id'> & { id?: number }

type DirNode = Extract<Node, { type: FileType.Directory }>
type FileNode = Extract<Node, { type: FileType.RegularFile }>
// type SymLinkNode = Extract<Node, { type: FileType.SymbolicLink }>

function req<T extends {}>(f: () => IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const q = f()
		q.onsuccess = () => resolve(q.result)
		q.onerror = () => reject(q.error)
	})
}

function exec<T>(tx: IDBTransaction, f: () => Promise<T>) {
	return new Promise<T>((resolve, reject) => {
		const task = f()
		tx.oncomplete = () => task.then(v => resolve(v))
		tx.onerror = () => reject(tx.error)

		task.then(() => tx.commit()).catch(e => {
			tx.abort()
			reject(e)
		})
	})
}

abstract class IdbFileBase {
	#isLocked = false

	protected closed = false

	protected q: Promise<Block>[] = []
	protected b: Promise<Block>
	protected curr: number // index of the ID of the first block in `#bs`.
	protected isDirty = false // indicates whether current block is dirty or not.

	constructor(
		protected db: IDBDatabase,
		protected node: FileNode,
		protected name: string,
		atEnd: boolean,
	) {
		if (node.blockIds.length === 0) {
			this.curr = 0
			this.b = Promise.resolve(new Block(new Uint8Array(0)))
		} else {
			this.curr = atEnd ? Math.min(node.blockIds.length - 1, 0) : 0
			const id = node.blockIds[this.curr]
			let b = this.getBlock(id)
			if (atEnd) {
				b = b.then(async b => {
					await b.seek(0, io.Seek.End)
					return b
				})
			}
			this.b = b
		}
	}

	protected async getBlock(id: number) {
		const tx = this.db.transaction([BlockStoreName], 'readonly')
		const d = await exec(tx, async () => {
			const blocks = tx.objectStore(BlockStoreName)
			return await req<Uint8Array>(() => blocks.get(id))
		})

		return new Block(d)
	}

	protected do<T>(f: () => Promise<T>): Promise<T> {
		if (this.#isLocked) {
			return Promise.reject('operation is locked')
		}

		this.#isLocked = true
		return f().finally(() => {
			this.#isLocked = false
		})
	}

	protected async getNextBlock(): Promise<Block | undefined> {
		if (this.curr + 1 >= this.node.blockIds.length) {
			// No more blocks.
			return undefined
		}

		const b = await this.b
		if (this.isDirty) {
			const id = this.node.blockIds[this.curr]
			if (id === undefined) {
				throw new Error('invalid state: new block cannot be dirty')
			}

			const tx = this.db.transaction([BlockStoreName], 'readwrite')
			await exec(tx, async () => {
				const blocks = tx.objectStore(BlockStoreName)
				await req(() => blocks.put(b.data, id))
			})
			this.isDirty = false
		}

		if (this.q.length > 0) {
			this.b = this.q.shift() as Promise<Block>
		} else {
			// TODO: pre-load the blocks.
			// Current implementation loads a current block only (no pre-load).
			const id = this.node.blockIds[this.curr + 1]
			this.b = this.getBlock(id)
		}
		this.curr++

		return this.b
	}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: this.node.size,
			modTime: new Date(this.node.modTime),
			isDir: false,
		})
	}

	async seek(offset: number, whence?: io.Seek): Promise<number> {
		const b = await this.b
		const end = Block.Size * this.node.blockIds.length + b.length

		let i: number
		switch (whence) {
			case io.Seek.Start:
				i = 0
				break

			case io.Seek.Current: {
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
		if (d === 0) {
			await b.seek(bo, io.Seek.Start)
			return o
		}

		if (0 < d && d <= this.q.length) {
			this.q = this.q.slice(d - 1)
		} else {
			this.q = []

			const id = this.node.blockIds[bi]
			if (id === undefined) {
				throw new Error('invalid state: block index out of range')
			}

			const next = this.getBlock(id)
			this.q.push(next)
		}

		const next = await this.getNextBlock()
		if (next === undefined) {
			throw new Error('invalid state: next block must be exist')
		}

		await next.seek(bo, io.Seek.Start)
		return o
	}

	protected abstract onClose(): Promise<void>

	close(): Promise<void> {
		if (this.closed) return Promise.resolve()
		return this.do(() => this.onClose())
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return this.close()
	}
}

class ReadOnlyIdbFile extends IdbFileBase implements File {
	async #read(p: Span): Promise<number | null> {
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
				await this.getNextBlock()
			}
		}

		if (o === 0) {
			return null
		}
		return o
	}

	read(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.do(() => this.#read(p))
	}

	write(p: Span): Promise<number | null> {
		return Promise.reject(new Error('file is read only'))
	}

	protected override async onClose(): Promise<void> {
		const storeNames = [NodeStoreName]
		if (this.isDirty) {
			storeNames.push(BlockStoreName)
		}

		const tx = this.db.transaction(storeNames, 'readwrite')
		return exec(tx, async () => {
			const nodes = tx.objectStore(NodeStoreName)
			const node = await req<FileNode>(() => nodes.get(this.node.id))
			node.cntReaders--
			await req(() => nodes.put(node))

			if (!this.isDirty) {
				return
			}

			const b = await this.b
			const blocks = tx.objectStore(BlockStoreName)
			await req(() => blocks.put(b?.data))
		})
	}
}

class IdbFile extends ReadOnlyIdbFile implements File {
	async #write(p: Span): Promise<number> {
		let o = 0
		while (true) {
			if (o >= p.length) {
				return o
			}

			const b = await this.b
			const n = await b.write(p.subbuff(o))
			if (n === null) {
				const next = await this.getNextBlock()
				if (!next) {
					break
				}

				continue
			}

			this.isDirty = true
			o += n
		}

		// There is data remaining to be written and new blocks are needed.

		const b = await this.b
		const ds: Uint8Array[] = []
		for (; o < p.length; o += Block.Size) {
			ds.push(p.subbuff(o, o + Block.Size).data)
		}

		const tx = this.db.transaction([NodeStoreName, BlockStoreName], 'readwrite')
		this.node = await exec(tx, async () => {
			const blocks = tx.objectStore(BlockStoreName)
			const ids = (await Promise.all(ds.slice().map(d => req(() => blocks.add(d))))) as number[]
			if (this.isDirty) {
				await req(() => blocks.put(b))
			}

			const node = structuredClone(this.node)
			node.blockIds.push(...ids)
			node.size = node.blockIds.length * Block.Size + b.length

			const nodes = tx.objectStore(NodeStoreName)
			await req(() => nodes.put(node))

			return node
		})

		this.isDirty = false
		return o
	}

	write(p: Span): Promise<number | null> {
		if (this.closed) return Promise.resolve(null)
		return this.do(() => this.#write(p))
	}

	protected override async onClose(): Promise<void> {
		const b = await this.b
		const storeNames = [NodeStoreName]
		if (this.isDirty) {
			storeNames.push(BlockStoreName)
		}

		const tx = this.db.transaction(storeNames, 'readwrite')
		return exec(tx, async () => {
			const nodes = tx.objectStore(NodeStoreName)
			const node = this.node
			node.cntReaders--
			node.cntWriters--
			node.size = node.blockIds.length * Block.Size + b.length

			if (this.curr >= this.node.blockIds.length) {
				const blocks = tx.objectStore(BlockStoreName)
				const id = (await req(() => blocks.put(b.data))) as number
				node.blockIds.push(id)
				this.isDirty = false
			}

			await req(() => nodes.put(node))

			if (!this.isDirty) {
				return
			}

			const blocks = tx.objectStore(BlockStoreName)
			await req(() => blocks.put(b.data))
		})
	}
}

class AppendOnlyIdbFile extends IdbFile implements File {
	constructor(db: IDBDatabase, node: FileNode, name: string) {
		super(db, node, name, true)
	}

	read(p: io.Span): Promise<number | null> {
		return Promise.resolve(null)
	}

	override async seek(offset: number, whence?: io.Seek): Promise<number> {
		const b = await this.b
		const o = Block.Size * this.node.blockIds.length + b.length
		return Promise.resolve(o)
	}
}

class IdbDir implements File {
	constructor(
		protected db: IDBDatabase,
		protected node: DirNode,
		protected name: string,
	) {}

	stat(): Promise<FileInfo> {
		return Promise.resolve({
			name: this.name,
			size: 0,
			modTime: new Date(this.node.modTime),
			isDir: true,
		})
	}

	read(p: Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	seek(offset: number, whence?: io.Seek): Promise<number> {
		return Promise.reject(new errs.ErrDirectory())
	}

	write(p: Span): Promise<number | null> {
		return Promise.reject(new errs.ErrDirectory())
	}

	close(): Promise<void> {
		return Promise.resolve()
	}

	[Symbol.asyncDispose](): PromiseLike<void> {
		return Promise.resolve()
	}
}

type GetResult = {
	p: DirNode
	e: DirNode | FileNode | undefined
	n: string
	r: string
}

export class IdbFs implements Fs {
	constructor(private db: IDBDatabase) {}

	private async get_(nodes: IDBObjectStore, name: string, h: DirNode[]): Promise<Omit<GetResult, 'p'>> {
		// expect `name` to be clean.
		let e: DirNode | FileNode | undefined = h.pop() as DirNode // current visiting entry.
		let n = '' // name of `e`.
		let r: string | undefined = name
		for ([n, r] of path.entries(name)) {
			if (e.type === FileType.RegularFile) {
				throw new errs.ErrNotDirectory()
			}
			if (n === '..') {
				if (h.length > 0) {
					e = h.pop() as DirNode
				}
				continue
			}

			const nextId = e.entries[n]
			if (nextId === undefined) {
				return { e: undefined, n, r }
			}

			const next = await req((): IDBRequest<Node> => nodes.get(nextId))
			if (next.type === FileType.Directory) {
				h.push(next)
				e = next
				continue
			}
			if (next.type === FileType.RegularFile) {
				e = next
				continue
			}

			h.push(e)
			;({ e, n } = await this.get_(nodes, next.value, h))
			if (e === undefined) {
				throw new Error('broken link')
			}
		}

		if (e.type === FileType.Directory) {
			h.pop()
		}
		return { e, n, r }
	}

	private async get(nodes: IDBObjectStore, name: string): Promise<GetResult> {
		name = path.clean(name)
		const p = await req((): IDBRequest<DirNode> => nodes.get(RootNodeId))
		if (name === '.') {
			return {
				p,
				e: p,
				n: '/',
				r: name,
			}
		}

		const h = [p]
		const rst = await this.get_(nodes, name, h)
		return {
			...rst,
			p: h[h.length - 1] ?? p,
		}
	}

	private exec<T>(mode: IDBTransactionMode, f: (nodes: IDBObjectStore, tx: IDBTransaction) => Promise<T>) {
		const tx = this.db.transaction(NodeStoreName, mode)
		return exec(tx, () => f(tx.objectStore(NodeStoreName), tx))
	}

	private execRO<T>(f: (nodes: IDBObjectStore, tx: IDBTransaction) => Promise<T>) {
		return this.exec<T>('readonly', f)
	}

	private execRW<T>(f: (nodes: IDBObjectStore, tx: IDBTransaction) => Promise<T>) {
		return this.exec<T>('readwrite', f)
	}

	open(name: string): Promise<ReadOnlyFile> {
		return this.openFile(name, OpenFlag.Read, 0 as FileMode)
	}

	openFile(name: string, flag: OpenFlag, mode?: FileMode): Promise<File> {
		const isRO = (flag & (OpenFlag.Append | OpenFlag.Write | OpenFlag.Trunc)) === 0
		const atEnd = (flag & OpenFlag.AtEnd) > 0

		const tx = this.db.transaction([NodeStoreName, BlockStoreName], 'readwrite')
		return exec(tx, async () => {
			const nodes = tx.objectStore(NodeStoreName)
			const { p, e, n } = await this.get(nodes, name)
			switch (e?.type) {
				case FileType.Directory: {
					if (!isRO) {
						throw new errs.ErrDirectory()
					}

					return new IdbDir(this.db, e, n)
				}

				case FileType.RegularFile: {
					if (e.cntWriters > 0) {
						throw new errs.ErrBusy()
					}

					e.cntReaders++
					if (isRO) {
						await req(() => nodes.put(e))
						return new ReadOnlyIdbFile(this.db, e, n, atEnd)
					}

					const x = OpenFlag.Write | OpenFlag.NoReplace
					if ((flag & x) === x) {
						throw new errs.ErrExist()
					}
					if ((flag & (OpenFlag.Append | OpenFlag.Trunc)) === 0) {
						// TODO: Replace a file and return
						throw new Error('not implemented')
					}

					if ((flag & OpenFlag.Trunc) > 0) {
						// TODO: detach blocks
					}

					e.cntWriters++
					await req(() => nodes.put(e))
					if ((flag & OpenFlag.Append) > 0) {
						return new AppendOnlyIdbFile(this.db, e, n)
					}

					return new IdbFile(this.db, e, n, atEnd)
				}

				case undefined: {
					if (isRO) {
						throw new errs.ErrNotExist()
					}

					const nodeInput: NodeInput<FileNode> = {
						numLink: 1,
						mode: mode ?? (0o755 as FileMode),
						modTime: new Date().getTime(),
						type: FileType.RegularFile,
						blockIds: [],
						size: 0,
						cntReaders: 1,
						cntWriters: 1,
					}

					const id = (await req(() => nodes.add(nodeInput))) as number
					const node: FileNode = { id, ...nodeInput }
					p.entries[n] = id
					await req(() => nodes.put(p))

					const f = new IdbFile(this.db, node, n, atEnd)
					return f
				}

				default:
					throw new Error('unknown type of file')
			}
		})
	}

	create(name: string): Promise<File> {
		return this.openFile(name, OpenFlag.Write | OpenFlag.Trunc)
	}

	mkdir(name: string, mode = 0o0755 as FileMode): Promise<void> {
		return this.execRW(async nodes => {
			const { p, e, n, r } = await this.get(nodes, name)
			if (r !== '') {
				throw new errs.ErrNotDirectory()
			}
			if (e !== undefined) {
				throw new errs.ErrExist()
			}

			const nodeInput: NodeInput<DirNode> = {
				type: FileType.Directory,
				numLink: 1,
				mode,
				modTime: new Date().getTime(),
				entries: {},
			}

			const id = (await req(() => nodes.add(nodeInput))) as number
			p.entries[n] = id
			await req(() => nodes.put(p))
		})
	}

	mkdirAll(name: string, mode = 0o0755 as FileMode): Promise<void> {
		return this.execRW(async nodes => {
			const { p, e, n, r } = await this.get(nodes, name)
			switch (e?.type) {
				case undefined:
				case FileType.Directory:
					break

				default:
					throw new errs.ErrNotDirectory()
			}

			const nodeInput: NodeInput<DirNode> = {
				type: FileType.Directory,
				numLink: 1,
				mode,
				modTime: new Date().getTime(),
				entries: {},
			}

			for (const [n] of path.entriesReverse(r)) {
				const id = (await req(() => nodes.add(nodeInput))) as number
				nodeInput.entries = { [n]: id }
			}

			const id = (await req(() => nodes.add(nodeInput))) as number
			p.entries[n] = id
			await req(() => nodes.put(p))
		})
	}

	rename(oldname: string, newname: string): Promise<void> {
		return this.execRW(async nodes => {
			const a = await this.get(nodes, oldname)
			if (!a.e) {
				throw new errs.ErrNotExist()
			}

			const b = await this.get(nodes, newname)
			if (b.r !== '') {
				throw new errs.ErrNotDirectory()
			}

			if (a.e.id === b.e?.id) {
				// Same file.
				return
			}

			if (b.e !== undefined) {
				if (a.e.type === FileType.RegularFile) {
					if (b.e.type === FileType.Directory) {
						throw new errs.ErrDirectory()
					}
				} else {
					// `a` is a directory
					if (b.e.type === FileType.Directory && Object.keys(b.e.entries).length > 0) {
						throw new errs.ErrDirectoryNotEmpty()
					}
					if (b.e.type === FileType.RegularFile) {
						throw new errs.ErrNotDirectory()
					}
				}

				b.e.numLink--
			}

			delete a.p.entries[a.n]
			if (a.p.id === b.p.id) {
				a.p.entries[b.n] = a.e.id
				await req(() => nodes.put(a.p))
			} else {
				b.p.entries[b.n] = a.e.id
				await Promise.all([
					req(() => nodes.put(a.p)), //
					req(() => nodes.put(b.p)),
				])
			}
		})
	}

	remove(name: string): Promise<void> {
		return this.execRW(async nodes => {
			const { p, e, n, r } = await this.get(nodes, name)
			if (e === undefined) {
				throw new errs.ErrNotExist()
			}
			if (r !== '') {
				throw new errs.ErrNotDirectory()
			}
			if (e.type === FileType.Directory && Object.keys(e.entries).length > 0) {
				throw new errs.ErrDirectoryNotEmpty()
			}

			delete p.entries[n]
			e.numLink--

			await Promise.all([
				req(() => nodes.put(p)), //
				req(() => nodes.put(e)),
			])
		})
	}

	async *readDir(name: string): AsyncIterable<DirEntry> {
		const es = await this.execRO(async nodes => {
			const { e, r } = await this.get(nodes, name)
			if (r !== '') {
				throw new errs.ErrNotDirectory()
			}
			if (e === undefined) {
				throw new errs.ErrNotExist()
			}
			if (e.type === FileType.RegularFile) {
				throw new errs.ErrNotDirectory()
			}

			return e.entries
		})

		for (const [name, e] of Object.entries(es)) {
			if (!e) continue

			const node = await this.execRO(nodes => req<Node>(() => nodes.get(e)))
			if (node.numLink === 0) continue

			const modTime = new Date(node.modTime)
			switch (node.type) {
				case FileType.Directory:
					yield {
						name,
						isDir: true,
						info: () =>
							Promise.resolve({
								name,
								isDir: true,
								modTime,
								size: 0,
							}),
					}
					break

				case FileType.RegularFile:
					yield {
						name,
						isDir: false,
						info: () =>
							Promise.resolve({
								name,
								isDir: false,
								modTime,
								size: node.size,
							}),
					}
					break

				default:
					throw new Error('unknown type of node')
			}
		}
	}

	stat(name: string): Promise<FileInfo> {
		return this.execRO(async (nodes): Promise<FileInfo> => {
			const { e, n } = await this.get(nodes, name)
			if (e === undefined) {
				throw new errs.ErrNotExist()
			}

			const modTime = new Date(e.modTime)
			return e.type === FileType.RegularFile
				? {
						name: n,
						size: e.size,
						modTime,
						isDir: false,
					}
				: {
						name: n,
						size: 0,
						modTime,
						isDir: true,
					}
		})
	}

	delete() {
		indexedDB.deleteDatabase(this.db.name)
	}
}
