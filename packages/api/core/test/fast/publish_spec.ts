import { expect } from 'chai';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import proxyquire from 'proxyquire';
import sinon, { SinonStub, SinonSpy } from 'sinon';

import { PublishOptions } from '../../src/api';

describe('publish', () => {
  let publish: (opts: PublishOptions) => Promise<void>;
  let makeStub: SinonStub;
  let resolveStub: SinonStub;
  let publisherSpy: SinonStub;
  let voidStub: SinonStub;
  let nowhereStub: SinonStub;
  let publishers: string[];

  beforeEach(() => {
    resolveStub = sinon.stub();
    makeStub = sinon.stub();
    publisherSpy = sinon.stub();
    voidStub = sinon.stub();
    nowhereStub = sinon.stub();
    publishers = ['@electron-forge/publisher-test'];
    const fakePublisher = (stub: SinonStub) => class {
      private publish: SinonStub;
      constructor() {
        this.publish = stub;
      }
    };

    publish = proxyquire.noCallThru().load('../../src/api/publish', {
      './make': async (...args: any[]) => makeStub(...args),
      '../util/resolve-dir': async (dir: string) => resolveStub(dir),
      '../util/read-package-json': () => Promise.resolve(require('../fixture/dummy_app/package.json')),
      '../util/forge-config': async () => {
        const config = await (require('../../src/util/forge-config').default(path.resolve(__dirname, '../fixture/dummy_app')));

        config.publishers = publishers;
        return config;
      },
      '@electron-forge/publisher-test': fakePublisher(publisherSpy),
      void: fakePublisher(voidStub),
      nowhere: fakePublisher(nowhereStub),
    }).default;

    publisherSpy.returns(Promise.resolve());
    resolveStub.returns(path.resolve(__dirname, '../fixture/dummy_app'));
    makeStub.returns([]);
  });

  it('should should call make with makeOptions', async () => {
    await publish({
      dir: __dirname,
      interactive: false,
    });
    expect(makeStub.callCount).to.equal(1);
  });

  it('should call the resolved publisher with the appropriate args', async () => {
    makeStub.returns([{ artifacts: ['artifact1', 'artifact2'] }]);
    await publish({
      dir: __dirname,
      interactive: false,
    });
    expect(publisherSpy.callCount).to.equal(1);
    // pluginInterface will be a new instance so we ignore it
    delete publisherSpy.firstCall.args[0].forgeConfig.pluginInterface;
    const testConfig = await require('../../src/util/forge-config').default(path.resolve(__dirname, '../fixture/dummy_app'));

    testConfig.publishers = publishers;

    delete testConfig.pluginInterface;
    expect(publisherSpy.firstCall.args).to.deep.equal([{
      dir: resolveStub(),
      makeResults: [{ artifacts: ['artifact1', 'artifact2'] }],
      forgeConfig: testConfig,
    }]);
  });

  it('should call the provided publisher with the appropriate args', async () => {
    makeStub.returns([{ artifacts: ['artifact1', 'artifact2'] }]);
    await publish({
      dir: __dirname,
      interactive: false,
      // Fake instance of a publisher
      publishTargets: [{
        __isElectronForgePublisher: true,
        publish: publisherSpy,
        platforms: null,
      } as any],
    });
    expect(publisherSpy.callCount).to.equal(1);
    // pluginInterface will be a new instance so we ignore it
    delete publisherSpy.firstCall.args[0].forgeConfig.pluginInterface;
    const testConfig = await require('../../src/util/forge-config').default(path.resolve(__dirname, '../fixture/dummy_app'));

    testConfig.publishers = publishers;

    delete testConfig.pluginInterface;
    expect(publisherSpy.firstCall.args).to.deep.equal([{
      dir: resolveStub(),
      makeResults: [{ artifacts: ['artifact1', 'artifact2'] }],
      forgeConfig: testConfig,
    }]);
  });

  it('should default to publishing nothing', async () => {
    publishers = [];
    await publish({
      dir: __dirname,
      interactive: false,
    });
    expect(publisherSpy.callCount).to.equal(0);
  });

  it('should resolve publishers when given a string name', async () => {
    expect(voidStub.callCount).to.equal(0);
    await publish({
      dir: __dirname,
      interactive: false,
      publishTargets: ['void'],
    });
    expect(voidStub.callCount).to.equal(1);
  });

  it('should resolve consecutive publishers when given an array of names', async () => {
    expect(voidStub.callCount).to.equal(0);
    expect(nowhereStub.callCount).to.equal(0);
    await publish({
      dir: __dirname,
      interactive: false,
      publishTargets: ['void', 'nowhere'],
    });
    expect(voidStub.callCount).to.equal(1);
    expect(nowhereStub.callCount).to.equal(1);
  });

  describe('dry run', () => {
    let dir: string;

    const fakeMake = (platform: string) => {
      const ret = [
        { artifacts: [
          path.resolve(dir, `out/make/artifact1-${platform}`),
          path.resolve(dir, `out/make/artifact2-${platform}`),
        ] }, { artifacts: [
          path.resolve(dir, `out/make/artifact3-${platform}`),
        ] },
        { artifacts: [
          path.resolve(dir, `out/make/artifact4-${platform}`),
        ] },
      ];
      const state = {
        platform,
        arch: 'x64',
        packageJSON: { state: platform === 'darwin' ? 1 : 0 },
      };
      Object.assign(ret[0], state);
      Object.assign(ret[1], state);
      Object.assign(ret[2], state);
      return ret;
    };

    before(async () => {
      dir = await fs.mkdtemp(path.resolve(os.tmpdir(), 'electron-forge-test-'));
    });

    describe('when creating a dry run', () => {
      beforeEach(async () => {
        makeStub.returns(fakeMake('darwin'));
        const dryPath = path.resolve(dir, 'out', 'publish-dry-run');
        await fs.mkdirs(dryPath);
        await fs.writeFile(path.resolve(dryPath, 'hash.json'), 'test');
        await publish({
          dir,
          interactive: false,
          dryRun: true,
        });
        expect(await fs.pathExists(path.resolve(dryPath, 'hash.json'))).to.equal(false, 'previous hashes should be erased');
        const backupDir = path.resolve(dir, 'out', 'backup');
        await fs.move(dryPath, backupDir);
        makeStub.returns(fakeMake('win32'));
        await publish({
          dir,
          interactive: false,
          dryRun: true,
        });
        for (const backedUp of await fs.readdir(backupDir)) {
          await fs.copy(path.resolve(backupDir, backedUp), path.resolve(dryPath, backedUp));
        }
      });

      it('should create dry run hash JSON files', async () => {
        expect(makeStub.callCount).to.equal(2);
        const dryRunFolder = path.resolve(dir, 'out', 'publish-dry-run');
        expect(await fs.pathExists(dryRunFolder)).to.equal(true);

        const hashFolders = await fs.readdir(dryRunFolder);
        expect(hashFolders).to.have.length(2, 'Should contain two hashes (two publishes)');
        for (const hashFolderName of hashFolders) {
          const hashFolder = path.resolve(dryRunFolder, hashFolderName);
          const makes = await fs.readdir(hashFolder);
          expect(makes).to.have.length(3, 'Should contain the results of three makes');
          for (const makeJson of makes) {
            const jsonPath = path.resolve(hashFolder, makeJson);
            const contents = await fs.readFile(jsonPath, 'utf8');
            expect(() => JSON.parse(contents), 'Should be valid JSON').to.not.throw();
            const data = JSON.parse(contents);
            expect(data).to.have.property('artifacts');
            expect(data).to.have.property('platform');
            expect(data).to.have.property('arch');
            expect(data).to.have.property('packageJSON');

            // Make the artifacts for later
            for (const artifactPath of data.artifacts) {
              await fs.mkdirp(path.dirname(path.resolve(dir, artifactPath)));
              await fs.writeFile(path.resolve(dir, artifactPath), artifactPath);
            }
          }
        }
      });
    });

    describe('when resuming a dry run', () => {
      beforeEach(async () => {
        await publish({
          dir,
          interactive: false,
          publishTargets: ['@electron-forge/publisher-test'],
          dryRunResume: true,
        });
      });

      it('should successfully restore values and pass them to publisher', () => {
        expect(makeStub.callCount).to.equal(0);
        expect(publisherSpy.callCount).to.equal(2, 'should call once for each platform (make run)');
        const darwinIndex = publisherSpy.firstCall.args[0].makeResults[0].artifacts.some((a: string) => a.indexOf('darwin') !== -1) ? 0 : 1;
        const win32Index = darwinIndex === 0 ? 1 : 0;
        const darwinArgs = publisherSpy.getCall(darwinIndex).args[0];
        const darwinArtifacts = [];
        for (const result of darwinArgs.makeResults) {
          darwinArtifacts.push(...result.artifacts);
        }
        expect(darwinArtifacts.sort()).to.deep.equal(
          fakeMake('darwin').reduce((accum, val) => accum.concat(val.artifacts), [] as string[]).sort(),
        );
        const win32Args = publisherSpy.getCall(win32Index).args[0];
        const win32Artifacts = [];
        for (const result of win32Args.makeResults) {
          win32Artifacts.push(...result.artifacts);
        }
        expect(win32Artifacts.sort()).to.deep.equal(
          fakeMake('win32').reduce((accum, val) => accum.concat(val.artifacts), [] as string[]).sort(),
        );
      });
    });

    after(async () => {
      await fs.remove(dir);
    });
  });
});
