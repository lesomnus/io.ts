export class PathError extends Error {
	#p_: string

	constructor(
		public op: string,
		path: string,
		options?: ErrorOptions,
	) {
		super(`${op} ${path}`, options)
		this.#p_ = path
	}

	get path(): string {
		return this.#p_
	}
	set path(path: string) {
		this.#p_ = path
		this.message = `${this.op} ${path}`
	}
}

export function isPathError(e: unknown): e is PathError {
	return Object.getPrototypeOf(e) === PathError
}

class FsError extends Error {}

export class ErrExist extends FsError {
	constructor() {
		super('file already exists')
	}
}
export class ErrNotExist extends FsError {
	constructor() {
		super('file does not exist')
	}
}
export class ErrDirectory extends FsError {
	constructor() {
		super('file is a directory')
	}
}
export class ErrNotDirectory extends FsError {
	constructor() {
		super('file is not a directory')
	}
}
export class ErrDirectoryNotEmpty extends FsError {
	constructor() {
		super('directory is not empty')
	}
}
export class ErrBusy extends FsError {
	constructor() {
		super('file is busy')
	}
}
export class ErrReadOnly extends FsError {
	constructor() {
		super('file is read only')
	}
}
