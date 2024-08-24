import type { FileMode, OpenFlag } from './constants'
import type { DirEntry, File, FileInfo, Fs, PartialFs, ReadOnlyFile } from './types'

export class FsForward implements Fs {
	constructor(private fsys: PartialFs) {}

	private given<T>(f: T | undefined): T | never {
		if (f) return f
		throw new Error('underlying file system does not does implement this method')
	}

	open(name: string): Promise<ReadOnlyFile> {
		return this.given(this.fsys.open)(name)
	}
	openFile(name: string, flag: OpenFlag, mode: FileMode): Promise<File> {
		return this.given(this.fsys.openFile)(name, flag, mode)
	}
	create(name: string): Promise<File> {
		return this.given(this.fsys.create)(name)
	}
	mkdir(name: string, mode: FileMode): Promise<void> {
		return this.given(this.fsys.mkdir)(name, mode)
	}
	mkdirAll(name: string, mode: FileMode): Promise<void> {
		return this.given(this.fsys.mkdirAll)(name, mode)
	}
	rename(oldname: string, newname: string): Promise<void> {
		return this.given(this.fsys.rename)(oldname, newname)
	}
	remove(name: string): Promise<void> {
		return this.given(this.fsys.remove)(name)
	}
	readDir(name: string): AsyncIterable<DirEntry> {
		return this.given(this.fsys.readDir)(name)
	}
	stat(name: string): Promise<FileInfo> {
		return this.given(this.fsys.stat)(name)
	}
}
