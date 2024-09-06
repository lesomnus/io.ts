import path from '.'

test.each([
	// Already clean
	['', '.'],
	['abc', 'abc'],
	['abc/def', 'abc/def'],
	['a/b/c', 'a/b/c'],
	['.', '.'],
	['..', '..'],
	['../..', '../..'],
	['../../abc', '../../abc'],
	['/abc', '/abc'],
	['/', '/'],

	// Remove trailing slash
	['abc/', 'abc'],
	['abc/def/', 'abc/def'],
	['a/b/c/', 'a/b/c'],
	['./', '.'],
	['../', '..'],
	['../../', '../..'],
	['/abc/', '/abc'],

	// Remove doubled slash
	['abc//def//ghi', 'abc/def/ghi'],
	['//abc', '/abc'],
	['///abc', '/abc'],
	['//abc//', '/abc'],
	['abc//', 'abc'],

	// Remove . elements
	['abc/./def', 'abc/def'],
	['/./abc/def', '/abc/def'],
	['abc/.', 'abc'],

	// Remove .. elements
	['abc/def/ghi/../jkl', 'abc/def/jkl'],
	['abc/def/../ghi/../jkl', 'abc/jkl'],
	['abc/def/..', 'abc'],
	['abc/def/../..', '.'],
	['/abc/def/../..', '/'],
	['abc/def/../../..', '..'],
	['/abc/def/../../..', '/'],
	['abc/def/../../../ghi/jkl/../../../mno', '../../mno'],

	// Combinatiots
	['abc/./../def', 'def'],
	['abc//./../def', 'def'],
	['abc/../../././../def', '../../def'],
])('clean(%s)=>%s', (given, expected) => {
	const actual = path.clean(given)
	expect(actual).to.eq(expected)
})

test.each([
	// zero parameters
	[[], ''],

	// one parameter
	[[''], ''],
	[['a'], 'a'],

	// two parameters
	[['a', 'b'], 'a/b'],
	[['a', ''], 'a'],
	[['', 'b'], 'b'],
	[['/', 'a'], '/a'],
	[['/', ''], '/'],
	[['a/', 'b'], 'a/b'],
	[['a/', ''], 'a'],
	[['', ''], ''],
])('join(%j)=>%s', (given, expected) => {
	const actual = path.join(...given)
	expect(actual).to.eq(expected)
})

test.each([
	['', '.'],
	['.', '.'],
	['/.', '.'],
	['/', '/'],
	['////', '/'],
	['x/', 'x'],
	['abc', 'abc'],
	['abc/def', 'def'],
	['a/b/.x', '.x'],
	['a/b/c.', 'c.'],
	['a/b/c.x', 'c.x'],
])('base(%s)=>%s', (given, expected) => {
	const actual = path.base(given)
	expect(actual).to.eq(expected)
})

test.each([
	['a/b', ['a/', 'b']],
	['a/b/', ['a/b/', '']],
	['a/', ['a/', '']],
	['a', ['', 'a']],
	['/', ['/', '']],
])('split(%s)=>%j', (given, expected) => {
	const actual = path.split(given)
	expect([...actual]).to.eql(expected)
})

test.each([
	['', '.'],
	['.', '.'],
	['/.', '/'],
	['/', '/'],
	['////', '/'],
	['/foo', '/'],
	['x/', 'x'],
	['abc', '.'],
	['abc/def', 'abc'],
	['abc////def', 'abc'],
	['a/b/.x', 'a/b'],
	['a/b/c.', 'a/b'],
	['a/b/c.x', 'a/b'],
])('dir(%s)=>%s', (given, expected) => {
	const actual = path.dir(given)
	expect(actual).to.eql(expected)
})

test.each([
	[
		'foo/bar/baz',
		[
			['foo', 'bar/baz'],
			['bar', 'baz'],
			['baz', ''],
		],
	],
	[
		'/foo/bar/baz',
		[
			['foo', 'bar/baz'],
			['bar', 'baz'],
			['baz', ''],
		],
	],
	[
		'foo/bar/baz/',
		[
			['foo', 'bar/baz/'],
			['bar', 'baz/'],
			['baz', ''],
		],
	],
	[
		'/foo/bar/baz/',
		[
			['foo', 'bar/baz/'],
			['bar', 'baz/'],
			['baz', ''],
		],
	],
	[
		'foo//bar',
		[
			['foo', '/bar'],
			['', 'bar'],
			['bar', ''],
		],
	],
])('entries(%s)=>%j', (given, expected) => {
	const actual = path.entries(given)
	expect([...actual]).to.eql(expected)
})

test.each([
	[
		'foo/bar/baz',
		[
			['baz', ''],
			['bar', 'baz'],
			['foo', 'bar/baz'],
		],
	],
	[
		'/foo/bar/baz',
		[
			['baz', ''],
			['bar', 'baz'],
			['foo', 'bar/baz'],
		],
	],
	[
		'foo/bar/baz/',
		[
			['baz', ''],
			['bar', 'baz/'],
			['foo', 'bar/baz/'],
		],
	],
	[
		'/foo/bar/baz/',
		[
			['baz', ''],
			['bar', 'baz/'],
			['foo', 'bar/baz/'],
		],
	],
	[
		'foo//bar',
		[
			['bar', ''],
			['', 'bar'],
			['foo', '/bar'],
		],
	],
])('entriesReverse(%s)=>%j', (given, expected) => {
	const actual = path.entriesReverse(given)
	expect([...actual]).to.eql(expected)
})
