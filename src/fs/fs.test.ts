import io from '~/.'
import fs from '.'

type TestCase = [string, () => Promise<fs.Fs>]
const testCases: TestCase[] = [
	//
	['memfs', () => Promise.resolve(new fs.MemFs())],
]
if (expect.getState().environment === 'browser') {
	// testCases.push([
	// 	'idbfs',
	// 	async () => {
	// 		const name = Math.random().toString(36).substring(2, 12)
	// 		const fsys = await fs.newIdbFs(name)
	// 		onTestFinished(() => fsys.delete())
	// 		return fsys
	// 	},
	// ])
}

// TODO: how to make T to be variadic within Promise<T>?
async function using<T extends AsyncDisposable>(vs: [...Promise<T>[]]): Promise<void>
async function using<T extends AsyncDisposable, U>(vs: [...Promise<T>[]], f: (...vs: [...T[]]) => Promise<U>): Promise<U>
async function using<T extends AsyncDisposable, U>(vs: [...Promise<T>[]], f?: (...vs: [...T[]]) => Promise<U>) {
	const ws = await Promise.all(vs)
	const exec = f ? f(...ws) : Promise.resolve()
	return exec.finally(async () => {
		ws.reverse()
		for (const w of ws) {
			await w[Symbol.asyncDispose]()
		}
	})
}

describe.each(testCases)('%s', (_, make) => {
	let fsys: fs.Fs
	beforeEach(async () => {
		fsys = await make()
	})

	test('mkdir', async () => {
		await fsys.mkdir('foo')

		{
			const info = await fsys.stat('foo')
			expect(info.isDir).to.be.true
		}

		{
			await using([fsys.create('foo/bar')])
			const info = await fsys.stat('foo/bar')
			expect(info.isDir).to.be.false
		}
	})
	test('mkdirAll', async () => {
		await fsys.mkdir('foo')

		await fsys.mkdirAll('foo/bar/baz')
		const info = await fsys.stat('foo/bar/baz')
		expect(info.isDir).to.be.true
	})
	test('rename a file', async () => {
		const d = io.from([1, 2, 3])
		await using([fsys.create('foo')], f => f.write(d))

		await fsys.rename('foo', 'bar')
		const p = await using([fsys.open('bar')], f => io.readAll(f))
		expect([...p]).to.eql([...d])
	})
	test('rename a file to a file', async () => {
		const d = io.from([1, 2, 3])
		await using([fsys.create('foo')], f => f.write(d))
		await using([fsys.create('bar')], f => f.write(io.from([4, 5])))

		await fsys.rename('foo', 'bar')
		const p = await using([fsys.open('bar')], f => io.readAll(f))
		expect([...p]).to.eql([...d])
	})
	test('rename a file to a directory', async () => {
		await using([fsys.create('foo')], f => f.write(io.from([1, 2, 3])))
		await fsys.mkdir('bar')

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrDirectory)
	})
	test('rename a directory', async () => {
		const d = io.from([1, 2, 3])
		await fsys.mkdir('foo')
		await using([fsys.create('foo/baz')], f => f.write(d))

		await fsys.rename('foo', 'bar')
		const p = await using([fsys.open('bar/baz')], f => io.readAll(f))
		expect([...p]).to.eql([...d])
	})
	test('rename a directory to a file', async () => {
		await fsys.mkdir('foo')
		await using([fsys.create('bar')], f => f.write(io.from([1, 2, 3])))

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrNotDirectory)
	})
	test('rename a directory to a directory that is empty', async () => {
		const d = io.from([1, 2, 3])
		await fsys.mkdir('foo')
		await fsys.mkdir('bar')
		await using([fsys.create('foo/baz')], f => f.write(d))

		await fsys.rename('foo', 'bar')
		const p = await using([fsys.open('bar/baz')], f => io.readAll(f))
		expect([...p]).to.eql([...d])
	})
	test('rename a directory to a directory that is not empty', async () => {
		const d = io.from([1, 2, 3])
		await fsys.mkdir('foo')
		await fsys.mkdir('bar')
		await using([fsys.create('bar/baz')], f => f.write(d))

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrDirectoryNotEmpty)
	})
	test('remove a file', async () => {
		await using([fsys.create('foo')], f => f.write(io.from([1, 2, 3])))
		await expect(fsys.stat('foo')).resolves.toBeTruthy()

		await fsys.remove('foo')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)
	})
	test('remove a directory that is empty', async () => {
		await fsys.mkdir('foo')
		await expect(fsys.stat('foo')).resolves.toBeTruthy()

		await fsys.remove('foo')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)
	})
	test('remove a directory that is not empty', async () => {
		await fsys.mkdir('foo')
		await fsys.mkdir('foo/bar')
		await expect(fsys.stat('foo/bar')).resolves.toBeTruthy()

		const op = () => fsys.remove('foo')
		await expect(op).rejects.toThrow(fs.ErrDirectoryNotEmpty)
	})
	test('link', async () => {
		const d1 = io.from([1, 2, 3])
		const d2 = io.from([41, 42, 43])
		await using([fsys.create('foo')], f => f.write(d1))

		await fsys.link('foo', 'bar')
		await using([fsys.open('bar')], async f => {
			const p = await io.readAll(f)
			expect([...p]).to.eql([...d1])
		})

		await using([fsys.create('foo')], f => f.write(d2))
		await using([fsys.open('bar')], async f => {
			const p = await io.readAll(f)
			expect([...p]).to.eql([...d2])
		})

		await fsys.remove('foo')
		await using([fsys.open('bar')], async f => {
			const p = await io.readAll(f)
			expect([...p]).to.eql([...d2])
		})
	})
	test('symlink', async () => {
		const d1 = io.from([1, 2, 3])
		const d2 = io.from([41, 42, 43])
		await using([fsys.create('foo')], f => f.write(d1))

		await fsys.symlink('foo', 'bar')
		await using([fsys.open('bar')], async f => {
			const p = await io.readAll(f)
			expect([...p]).to.eql([...d1])
		})

		await using([fsys.create('foo')], f => f.write(d2))
		await using([fsys.open('bar')], async f => {
			const p = await io.readAll(f)
			expect([...p]).to.eql([...d2])
		})

		await fsys.remove('foo')
		const op = fsys.stat('bar')
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('lstat a symlink', async () => {
		await fsys.symlink('foo', 'bar')
		await expect(fsys.lstat('bar')).resolves.toBeTruthy()
	})
	test('lstat a file', async () => {
		await using([fsys.create('foo')], async f => true)

		const info1 = await fsys.stat('foo')
		const info2 = await fsys.lstat('foo')
		expect(info2).to.eql(info1)
	})
	test('lstat a directory', async () => {
		await fsys.mkdir('foo')

		const info1 = await fsys.stat('foo')
		const info2 = await fsys.lstat('foo')
		expect(info2).to.eql(info1)
	})
	test('readLink a symlink', async () => {
		const link = 'foo'

		await fsys.symlink(link, 'bar')
		await expect(fsys.readLink('bar')).resolves.toEqual(link)
	})
})
