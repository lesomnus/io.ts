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

	private handle<T>(op: Promise<T>): Promise<T> {
		return op.catch(this.handleErr.bind(this))
	}

	lstat(name: string): Promise<FileInfo> {
		const full = this.fullName('open', name)
		return this.handle(this.fsys.lstat(full))
	}
	stat(name: string): Promise<FileInfo> {
		const full = this.fullName('open', name)
		return this.handle(this.fsys.stat(full))
	}

	openFile(name: string, flag: OpenFlag, mode: FileMode): Promise<File> {
		const full = this.fullName('open', name)
		return this.handle(this.fsys.openFile(full, flag, mode))
	}
	open(name: string): Promise<ReadOnlyFile> {
		const full = this.fullName('open', name)
		return this.handle(this.fsys.open(full))
	}
	create(name: string): Promise<File> {
		const full = this.fullName('create', name)
		return this.handle(this.fsys.create(full))
	}
	mkdir(name: string, mode: FileMode): Promise<void> {
		const full = this.fullName('mkdir', name)
		return this.handle(this.fsys.mkdir(full, mode))
	}
	mkdirAll(name: string, mode: FileMode): Promise<void> {
		const full = this.fullName('mkdirAll', name)
		return this.handle(this.fsys.mkdirAll(full, mode))
	}
	async *readDir(name: string): AsyncIterable<DirEntry> {
		yield* this.fsys.readDir(name)
	}
	rename(oldname: string, newname: string): Promise<void> {
		const oldfull = this.fullName('rename', oldname)
		const newfull = this.fullName('rename', newname)
		return this.handle(this.fsys.rename(oldfull, newfull))
	}
	remove(name: string): Promise<void> {
		const full = this.fullName('remove', name)
		return this.handle(this.fsys.remove(full))
	}
	link(oldname: string, newname: string): Promise<void> {
		const oldfull = this.fullName('rename', oldname)
		const newfull = this.fullName('rename', newname)
		return this.handle(this.fsys.link(oldfull, newfull))
	}
	symlink(oldname: string, newname: string): Promise<void> {
		const oldfull = this.fullName('rename', oldname)
		const newfull = this.fullName('rename', newname)
		return this.handle(this.fsys.symlink(oldfull, newfull))
	}
	readLink(name: string): Promise<string> {
		const full = this.fullName('readLink', name)
		return this.handle(this.fsys.readLink(full))
	}
}

type RequiredFieldsOnly<T> = {
	[K in keyof T as T[K] extends Required<T>[K] ? K : never]: T[K]
}

export function sub<T extends PartialFs>(fsys: T, dir: string) {
	return new SubFs(fsys, dir) as Pick<Fs, keyof RequiredFieldsOnly<T>>
}
