import type { Closer, Reader, Writer } from '~/io'

import type { FileMode, OpenFlag } from './constants'

export interface FileInfo {
	name: string
	size: number
	modTime: Date
	isDir: boolean
}

export interface DirEntry {
	name: string
	isDir: boolean
	info(): Promise<FileInfo>
}

export interface ReadOnlyFile extends Reader, Closer {
	stat(): Promise<FileInfo>
}

export interface File extends ReadOnlyFile, Writer {
	stat(): Promise<FileInfo>
}

export interface PartialFile extends ReadOnlyFile, Partial<Writer> {}

export interface ReadOnlyFs {
	open(name: string): Promise<ReadOnlyFile>
}

export interface ReadDirFs extends ReadOnlyFs {
	readDir(name: string): AsyncIterable<DirEntry>
}

export interface StatFs extends ReadOnlyFs {
	stat(name: string): Promise<FileInfo>
}

export interface Fs extends ReadDirFs, StatFs {
	open(name: string): Promise<ReadOnlyFile>
	openFile(name: string, flag: OpenFlag, mode: FileMode): Promise<File>
	create(name: string): Promise<File>
	mkdir(name: string, mode: FileMode): Promise<void>
	mkdirAll(name: string, mode: FileMode): Promise<void>
	rename(oldname: string, newname: string): Promise<void>
	remove(name: string): Promise<void>
}

export interface PartialFs extends Partial<Fs> {}
