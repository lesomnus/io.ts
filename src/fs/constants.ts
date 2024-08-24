export enum OpenFlag {
	Append = 1 << 0,
	Read = 1 << 1,
	Write = 1 << 2,
	Trunc = 1 << 3,
	AtEnd = 1 << 4,
	NoReplace = 1 << 5,
}

export enum FileMode {
	Perm = 0o777,
}
