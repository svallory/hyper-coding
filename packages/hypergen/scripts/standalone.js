#!/usr/bin/env node
const path = require('path')
const fs = require('fs-extra')
const execa = require('execa')

const package = require(path.join(__dirname, '../package.json'))
const wd = path.join(__dirname, '../standalone')
const v = package.version
const { name } = package

const plats = ['macos', 'win.exe', 'linux']
const repo = 'github.com/jondot/homebrew-tap'
const opts = { shell: true }

const main = async () => {
  for (const plat of plats) {
    console.log(`standalone: packing ${plat}`)
    const file = `${name}-${plat}`

    await fs.remove(`${wd}/tar-${file}`)
    await fs.mkdir(`${wd}/tar-${file}`)
    // give Windows special treatment: it should be a zip file and keep an .exe suffix
    if (plat === 'win.exe') {
      await fs.move(`${wd}/${file}`, `${wd}/tar-${file}/hypergen.exe`)
      await execa.command(
        `cd ${wd}/tar-${file} && zip ../hypergen.${plat}.v${v}.zip hypergen.exe`,
        opts,
      )
    } else {
      await fs.move(`${wd}/${file}`, `${wd}/tar-${file}/hypergen`)
      await execa.command(
        `cd ${wd}/tar-${file} && tar -czvf ../hypergen.${plat}.v${v}.tar.gz hypergen`,
        opts,
      )
    }
    await fs.remove(`${wd}/tar-${file}`)
  }

  console.log('standalone: done.')
  console.log((await execa.command(`ls ${wd}`, opts)).stdout)

  if (process.env.MANUAL_HB_PUBLISH) {
    console.log('standalone: publishing to homebrew tap...')
    const matches = (
      await execa.command(`shasum -a 256 ${wd}/hypergen.macos.v${v}.tar.gz`, opts)
    ).stdout.match(/([a-f0-9]+)\s+/)
    if (matches && matches.length > 1) {
      const sha = matches[1]
      await fs.writeFile('/tmp/hypergen.rb', brewFormula(sha, v)) // eslint-disable-line @typescript-eslint/no-use-before-define
      const cmd = [
        `cd /tmp`,
        `git clone git://${repo} brew-tap`,
        `cd brew-tap`,
        `mv /tmp/hypergen.rb .`,
        `git config user.email jondotan@gmail.com`,
        `git config user.name 'Dotan Nahum'`,
        `git add .`,
        `git commit -m 'hypergen: auto-release'`,
        `git push https://${process.env.GITHUB_TOKEN}@${repo}`,
      ].join(' && ')
      await execa.command(cmd, opts)

      console.log('standalone: publish done.')
    }
  }
}

const brewFormula = (sha, ver) => `
VER = "${ver}"
SHA = "${sha}"

class Hypergen < Formula
  desc "The scalable code generator that saves you time."
  homepage "https://hypergen.dev"
  url "https://github.com/svallory/hypergen/releases/download/v#{VER}/hypergen.macos.v#{VER}.tar.gz"
  version VER
  sha256 SHA

  def install
    bin.install "hypergen"
  end
end
`
main()
