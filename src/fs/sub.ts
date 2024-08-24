import path from '~/path'

import type { FileMode, OpenFlag } from './constants'
import { type PathError, isPathError } from './errors'
import type { DirEntry, File, FileInfo, Fs, PartialFs, ReadOnlyFile } from './types'
import { FsForward } from './util'

class SubFs implements Fs {
	private fsys: FsForward

	constructor(
		fsys: PartialFs,
		private dir: string,
	) {
		this.fsys = new FsForward(fsys)
	}

	private fullName(op: string, name: string): string {
		return path.join(this.dir, name)
	}

	private shorten(name: string): string | undefined {
		if (name === this.dir) return '.'

		const l = this.dir.length
		if (name.length >= l + 2 && name[l] === '/' && name.slice(0, l) === this.dir) {
			return name.slice(l + 1)
		}

		return undefined
	}

	private fixErr(err: PathError): never {
		const p = this.shorten(err.path)
		if (p !== undefined) err.path = p
		throw err
	}

	private handleErr(err: unknown): never {
		if (!isPathError(err)) throw err
		this.fixErr(err)
	}

	open(name: string): Promise<ReadOnlyFile> {
		const full = this.fullName('open', name)
		return this.fsys.open(full).catch(this.handleErr.bind(this))
	}

	openFile(name: string, flag: OpenFlag, mode: FileMode): Promise<File> {
		const full = this.fullName('open', name)
		return this.fsys.openFile(full, flag, mode).catch(this.handleErr.bind(this))
	}

	async *readDir(name: string): AsyncIterable<DirEntry> {
		yield* this.fsys.readDir(name)
	}

	create(name: string): Promise<File> {
		const full = this.fullName('create', name)
		return this.fsys.create(full).catch(this.handleErr.bind(this))
	}

	mkdir(name: string, mode: FileMode): Promise<void> {
		const full = this.fullName('mkdir', name)
		return this.fsys.mkdir(full, mode).catch(this.handleErr.bind(this))
	}

	mkdirAll(name: string, mode: FileMode): Promise<void> {
		const full = this.fullName('mkdirAll', name)
		return this.fsys.mkdirAll(full, mode).catch(this.handleErr.bind(this))
	}

	rename(oldname: string, newname: string): Promise<void> {
		const oldfull = this.fullName('rename', oldname)
		const newfull = this.fullName('rename', newname)
		return this.fsys.rename(oldfull, newfull).catch(this.handleErr.bind(this))
	}

	remove(name: string): Promise<void> {
		const full = this.fullName('remove', name)
		return this.fsys.remove(full).catch(this.handleErr.bind(this))
	}

	stat(name: string): Promise<FileInfo> {
		const full = this.fullName('open', name)
		return this.fsys.stat(full).catch(this.handleErr.bind(this))
	}
}

type RequiredFieldsOnly<T> = {
	[K in keyof T as T[K] extends Required<T>[K] ? K : never]: T[K]
}

export function sub<T extends PartialFs>(fsys: T, dir: string) {
	return new SubFs(fsys, dir) as Pick<Fs, keyof RequiredFieldsOnly<T>>
}
