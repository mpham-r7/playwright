/**
 * Copyright 2018 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const utils = require('./utils');
const {FFOX, CHROMIUM, WEBKIT} = utils.testOptions(browserType);

describe('Page.waitForTimeout', function() {
  it('should timeout', async({page, server}) => {
    const startTime = Date.now();
    const timeout = 42;
    await page.waitForTimeout(timeout);
    expect(Date.now() - startTime).not.toBeLessThan(timeout / 2);
  });
});

describe('Frame.waitForFunction', function() {
  it('should accept a string', async({page, server}) => {
    const watchdog = page.waitForFunction('window.__FOO === 1');
    await page.evaluate(() => window.__FOO = 1);
    await watchdog;
  });
  it('should work when resolved right before execution context disposal', async({page, server}) => {
    await page.addInitScript(() => window.__RELOADED = true);
    await page.waitForFunction(() => {
      if (!window.__RELOADED)
        window.location.reload();
      return true;
    });
  });
  it('should poll on interval', async({page, server}) => {
    const polling = 100;
    const timeDelta = await page.waitForFunction(() => {
      if (!window.__startTime) {
        window.__startTime = Date.now();
        return false;
      }
      return Date.now() - window.__startTime;
    }, {}, {polling});
    expect(timeDelta).not.toBeLessThan(polling);
  });
  it('should throw on polling:mutation', async({page, server}) => {
    const error = await page.waitForFunction(() => true, {}, {polling: 'mutation'}).catch(e => e);
    expect(error.message).toBe('Unknown polling option: mutation');
  });
  it('should poll on raf', async({page, server}) => {
    const watchdog = page.waitForFunction(() => window.__FOO === 'hit', {}, {polling: 'raf'});
    await page.evaluate(() => window.__FOO = 'hit');
    await watchdog;
  });
  it('should work with strict CSP policy', async({page, server}) => {
    server.setCSP('/empty.html', 'script-src ' + server.PREFIX);
    await page.goto(server.EMPTY_PAGE);
    let error = null;
    await Promise.all([
      page.waitForFunction(() => window.__FOO === 'hit', {}, {polling: 'raf'}).catch(e => error = e),
      page.evaluate(() => window.__FOO = 'hit')
    ]);
    expect(error).toBe(null);
  });
  it('should throw on bad polling value', async({page, server}) => {
    let error = null;
    try {
      await page.waitForFunction(() => !!document.body, {}, {polling: 'unknown'});
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.message).toContain('polling');
  });
  it('should throw negative polling interval', async({page, server}) => {
    let error = null;
    try {
      await page.waitForFunction(() => !!document.body, {}, {polling: -10});
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.message).toContain('Cannot poll with non-positive interval');
  });
  it('should return the success value as a JSHandle', async({page}) => {
    expect(await (await page.waitForFunction(() => 5)).jsonValue()).toBe(5);
  });
  it('should return the window as a success value', async({ page }) => {
    expect(await page.waitForFunction(() => window)).toBeTruthy();
  });
  it('should accept ElementHandle arguments', async({page}) => {
    await page.setContent('<div></div>');
    const div = await page.$('div');
    let resolved = false;
    const waitForFunction = page.waitForFunction(element => !element.parentElement, div).then(() => resolved = true);
    expect(resolved).toBe(false);
    await page.evaluate(element => element.remove(), div);
    await waitForFunction;
  });
  it('should respect timeout', async({page}) => {
    let error = null;
    await page.waitForFunction('false', {}, {timeout: 10}).catch(e => error = e);
    expect(error).toBeTruthy();
    expect(error.message).toContain('waiting for function failed: timeout');
    expect(error).toBeInstanceOf(playwright.errors.TimeoutError);
  });
  it('should respect default timeout', async({page}) => {
    page.setDefaultTimeout(1);
    let error = null;
    await page.waitForFunction('false').catch(e => error = e);
    expect(error).toBeInstanceOf(playwright.errors.TimeoutError);
    expect(error.message).toContain('waiting for function failed: timeout');
  });
  it('should disable timeout when its set to 0', async({page}) => {
    const watchdog = page.waitForFunction(() => {
      window.__counter = (window.__counter || 0) + 1;
      return window.__injected;
    }, {}, {timeout: 0, polling: 10});
    await page.waitForFunction(() => window.__counter > 10);
    await page.evaluate(() => window.__injected = true);
    await watchdog;
  });
  it('should survive cross-process navigation', async({page, server}) => {
    let fooFound = false;
    const waitForFunction = page.waitForFunction('window.__FOO === 1').then(() => fooFound = true);
    await page.goto(server.EMPTY_PAGE);
    expect(fooFound).toBe(false);
    await page.reload();
    expect(fooFound).toBe(false);
    await page.goto(server.CROSS_PROCESS_PREFIX + '/grid.html');
    expect(fooFound).toBe(false);
    await page.evaluate(() => window.__FOO = 1);
    await waitForFunction;
    expect(fooFound).toBe(true);
  });
  it('should survive navigations', async({page, server}) => {
    const watchdog = page.waitForFunction(() => window.__done);
    await page.goto(server.EMPTY_PAGE);
    await page.goto(server.PREFIX + '/consolelog.html');
    await page.evaluate(() => window.__done = true);
    await watchdog;
  });
  it('should work with multiline body', async({page, server}) => {
    const result = await page.waitForFunction(`
      (() => true)()
    `);
    expect(await result.jsonValue()).toBe(true);
  });
  it('should wait for predicate with arguments', async({page, server}) => {
    await page.waitForFunction(({arg1, arg2}) => arg1 + arg2 === 3, { arg1: 1, arg2: 2});
  });
});

describe('Frame.waitForSelector', function() {
  const addElement = tag => document.body.appendChild(document.createElement(tag));
  it('should immediately resolve promise if node exists', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    const frame = page.mainFrame();
    await frame.waitForSelector('*');
    await frame.evaluate(addElement, 'div');
    await frame.waitForSelector('div');
  });
  it('should work with removed MutationObserver', async({page, server}) => {
    await page.evaluate(() => delete window.MutationObserver);
    const [handle] = await Promise.all([
      page.waitForSelector('.zombo'),
      page.setContent(`<div class='zombo'>anything</div>`),
    ]);
    expect(await page.evaluate(x => x.textContent, handle)).toBe('anything');
  });
  it('should resolve promise when node is added', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    const frame = page.mainFrame();
    const watchdog = frame.waitForSelector('div');
    await frame.evaluate(addElement, 'br');
    await frame.evaluate(addElement, 'div');
    const eHandle = await watchdog;
    const tagName = await eHandle.getProperty('tagName').then(e => e.jsonValue());
    expect(tagName).toBe('DIV');
  });
  it('should resolve promise when node is added in shadow dom', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    const watchdog = page.waitForSelector('span');
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.attachShadow({mode: 'open'});
      document.body.appendChild(div);
    });
    await page.evaluate(() => new Promise(f => setTimeout(f, 100)));
    await page.evaluate(() => {
      const span = document.createElement('span');
      span.textContent = 'Hello from shadow';
      document.querySelector('div').shadowRoot.appendChild(span);
    });
    const handle = await watchdog;
    expect(await handle.evaluate(e => e.textContent)).toBe('Hello from shadow');
  });
  it('should work when node is added through innerHTML', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    const watchdog = page.waitForSelector('h3 div');
    await page.evaluate(addElement, 'span');
    await page.evaluate(() => document.querySelector('span').innerHTML = '<h3><div></div></h3>');
    await watchdog;
  });
  it('Page.$ waitFor is shortcut for main frame', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    await utils.attachFrame(page, 'frame1', server.EMPTY_PAGE);
    const otherFrame = page.frames()[1];
    const watchdog = page.waitForSelector('div');
    await otherFrame.evaluate(addElement, 'div');
    await page.evaluate(addElement, 'div');
    const eHandle = await watchdog;
    expect(await eHandle.ownerFrame()).toBe(page.mainFrame());
  });
  it('should run in specified frame', async({page, server}) => {
    await utils.attachFrame(page, 'frame1', server.EMPTY_PAGE);
    await utils.attachFrame(page, 'frame2', server.EMPTY_PAGE);
    const frame1 = page.frames()[1];
    const frame2 = page.frames()[2];
    const waitForSelectorPromise = frame2.waitForSelector('div');
    await frame1.evaluate(addElement, 'div');
    await frame2.evaluate(addElement, 'div');
    const eHandle = await waitForSelectorPromise;
    expect(await eHandle.ownerFrame()).toBe(frame2);
  });
  it('should throw when frame is detached', async({page, server}) => {
    await utils.attachFrame(page, 'frame1', server.EMPTY_PAGE);
    const frame = page.frames()[1];
    let waitError = null;
    const waitPromise = frame.waitForSelector('.box').catch(e => waitError = e);
    await utils.detachFrame(page, 'frame1');
    await waitPromise;
    expect(waitError).toBeTruthy();
    expect(waitError.message).toContain('waitForFunction failed: frame got detached.');
  });
  it('should survive cross-process navigation', async({page, server}) => {
    let boxFound = false;
    const waitForSelector = page.waitForSelector('.box').then(() => boxFound = true);
    await page.goto(server.EMPTY_PAGE);
    expect(boxFound).toBe(false);
    await page.reload();
    expect(boxFound).toBe(false);
    await page.goto(server.CROSS_PROCESS_PREFIX + '/grid.html');
    await waitForSelector;
    expect(boxFound).toBe(true);
  });
  it('should wait for visible', async({page, server}) => {
    let divFound = false;
    const waitForSelector = page.waitForSelector('div', { waitFor: 'visible' }).then(() => divFound = true);
    await page.setContent(`<div style='display: none; visibility: hidden;'>1</div>`);
    expect(divFound).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.removeProperty('display'));
    expect(divFound).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.removeProperty('visibility'));
    expect(await waitForSelector).toBe(true);
    expect(divFound).toBe(true);
  });
  it('should not consider visible when zero-sized', async({page, server}) => {
    await page.setContent(`<div style='width: 0; height: 0;'>1</div>`);
    let error = await page.waitForSelector('div', { waitFor: 'visible', timeout: 1000 }).catch(e => e);
    expect(error.message).toContain('timeout exceeded');
    await page.evaluate(() => document.querySelector('div').style.width = '10px');
    error = await page.waitForSelector('div', { waitFor: 'visible', timeout: 1000 }).catch(e => e);
    expect(error.message).toContain('timeout exceeded');
    await page.evaluate(() => document.querySelector('div').style.height = '10px');
    expect(await page.waitForSelector('div', { waitFor: 'visible', timeout: 1000 })).toBeTruthy();
  });
  it('should wait for visible recursively', async({page, server}) => {
    let divVisible = false;
    const waitForSelector = page.waitForSelector('div#inner', { waitFor: 'visible' }).then(() => divVisible = true);
    await page.setContent(`<div style='display: none; visibility: hidden;'><div id="inner">hi</div></div>`);
    expect(divVisible).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.removeProperty('display'));
    expect(divVisible).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.removeProperty('visibility'));
    expect(await waitForSelector).toBe(true);
    expect(divVisible).toBe(true);
  });
  it('hidden should wait for hidden', async({page, server}) => {
    let divHidden = false;
    await page.setContent(`<div style='display: block;'>content</div>`);
    const waitForSelector = page.waitForSelector('div', { waitFor: 'hidden' }).then(() => divHidden = true);
    await page.waitForSelector('div'); // do a round trip
    expect(divHidden).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.setProperty('visibility', 'hidden'));
    expect(await waitForSelector).toBe(true);
    expect(divHidden).toBe(true);
  });
  it('hidden should wait for display: none', async({page, server}) => {
    let divHidden = false;
    await page.setContent(`<div style='display: block;'>content</div>`);
    const waitForSelector = page.waitForSelector('div', { waitFor: 'hidden' }).then(() => divHidden = true);
    await page.waitForSelector('div'); // do a round trip
    expect(divHidden).toBe(false);
    await page.evaluate(() => document.querySelector('div').style.setProperty('display', 'none'));
    expect(await waitForSelector).toBe(true);
    expect(divHidden).toBe(true);
  });
  it('hidden should wait for removal', async({page, server}) => {
    await page.setContent(`<div>content</div>`);
    let divRemoved = false;
    const waitForSelector = page.waitForSelector('div', { waitFor: 'hidden' }).then(() => divRemoved = true);
    await page.waitForSelector('div'); // do a round trip
    expect(divRemoved).toBe(false);
    await page.evaluate(() => document.querySelector('div').remove());
    expect(await waitForSelector).toBe(true);
    expect(divRemoved).toBe(true);
  });
  it('should return null if waiting to hide non-existing element', async({page, server}) => {
    const handle = await page.waitForSelector('non-existing', { waitFor: 'hidden' });
    expect(handle).toBe(null);
  });
  it('should respect timeout', async({page, server}) => {
    let error = null;
    await page.waitForSelector('div', { timeout: 10 }).catch(e => error = e);
    expect(error).toBeTruthy();
    expect(error.message).toContain('waiting for selector "div" failed: timeout');
    expect(error).toBeInstanceOf(playwright.errors.TimeoutError);
  });
  it('should have an error message specifically for awaiting an element to be hidden', async({page, server}) => {
    await page.setContent(`<div>content</div>`);
    let error = null;
    await page.waitForSelector('div', { waitFor: 'hidden', timeout: 1000 }).catch(e => error = e);
    expect(error).toBeTruthy();
    expect(error.message).toContain('waiting for selector "[hidden] div" failed: timeout');
  });
  it('should respond to node attribute mutation', async({page, server}) => {
    let divFound = false;
    const waitForSelector = page.waitForSelector('.zombo').then(() => divFound = true);
    await page.setContent(`<div class='notZombo'></div>`);
    expect(divFound).toBe(false);
    await page.evaluate(() => document.querySelector('div').className = 'zombo');
    expect(await waitForSelector).toBe(true);
  });
  it('should return the element handle', async({page, server}) => {
    const waitForSelector = page.waitForSelector('.zombo');
    await page.setContent(`<div class='zombo'>anything</div>`);
    expect(await page.evaluate(x => x.textContent, await waitForSelector)).toBe('anything');
  });
  it('should have correct stack trace for timeout', async({page, server}) => {
    let error;
    await page.waitForSelector('.zombo', { timeout: 10 }).catch(e => error = e);
    expect(error.stack).toContain('waittask.spec.js');
  });
  it('should throw for unknown waitFor option', async({page, server}) => {
    await page.setContent('<section>test</section>');
    const error = await page.waitForSelector('section', { waitFor: 'foo' }).catch(e => e);
    expect(error.message).toContain('Unsupported waitFor option');
  });
  it('should throw for visibility option', async({page, server}) => {
    await page.setContent('<section>test</section>');
    const error = await page.waitForSelector('section', { visibility: 'hidden' }).catch(e => e);
    expect(error.message).toBe('options.visibility is not supported, did you mean options.waitFor?');
  });
  it('should throw for true waitFor option', async({page, server}) => {
    await page.setContent('<section>test</section>');
    const error = await page.waitForSelector('section', { waitFor: true }).catch(e => e);
    expect(error.message).toContain('Unsupported waitFor option');
  });
  it('should throw for false waitFor option', async({page, server}) => {
    await page.setContent('<section>test</section>');
    const error = await page.waitForSelector('section', { waitFor: false }).catch(e => e);
    expect(error.message).toContain('Unsupported waitFor option');
  });
  it('should support >> selector syntax', async({page, server}) => {
    await page.goto(server.EMPTY_PAGE);
    const frame = page.mainFrame();
    const watchdog = frame.waitForSelector('css=div >> css=span');
    await frame.evaluate(addElement, 'br');
    await frame.evaluate(addElement, 'div');
    await frame.evaluate(() => document.querySelector('div').appendChild(document.createElement('span')));
    const eHandle = await watchdog;
    const tagName = await eHandle.getProperty('tagName').then(e => e.jsonValue());
    expect(tagName).toBe('SPAN');
  });
  it('should wait for detached if already detached', async({page, server}) => {
    await page.setContent('<section id="testAttribute">43543</section>');
    expect(await page.waitForSelector('css=div', { waitFor: 'detached'})).toBe(null);
  });
  it('should wait for detached', async({page, server}) => {
    await page.setContent('<section id="testAttribute"><div>43543</div></section>');
    let done = false;
    const waitFor = page.waitForSelector('css=div', { waitFor: 'detached'}).then(() => done = true);
    expect(done).toBe(false);
    await page.waitForSelector('css=section');
    expect(done).toBe(false);
    await page.$eval('div', div => div.remove());
    expect(await waitFor).toBe(true);
    expect(done).toBe(true);
  });
});

describe('Frame.waitForSelector xpath', function() {
  const addElement = tag => document.body.appendChild(document.createElement(tag));

  it('should support some fancy xpath', async({page, server}) => {
    await page.setContent(`<p>red herring</p><p>hello  world  </p>`);
    const waitForXPath = page.waitForSelector('//p[normalize-space(.)="hello world"]');
    expect(await page.evaluate(x => x.textContent, await waitForXPath)).toBe('hello  world  ');
  });
  it('should respect timeout', async({page}) => {
    let error = null;
    await page.waitForSelector('//div', { timeout: 10 }).catch(e => error = e);
    expect(error).toBeTruthy();
    expect(error.message).toContain('waiting for selector "//div" failed: timeout');
    expect(error).toBeInstanceOf(playwright.errors.TimeoutError);
  });
  it('should run in specified frame', async({page, server}) => {
    await utils.attachFrame(page, 'frame1', server.EMPTY_PAGE);
    await utils.attachFrame(page, 'frame2', server.EMPTY_PAGE);
    const frame1 = page.frames()[1];
    const frame2 = page.frames()[2];
    const waitForXPathPromise = frame2.waitForSelector('//div');
    await frame1.evaluate(addElement, 'div');
    await frame2.evaluate(addElement, 'div');
    const eHandle = await waitForXPathPromise;
    expect(await eHandle.ownerFrame()).toBe(frame2);
  });
  it('should throw when frame is detached', async({page, server}) => {
    await utils.attachFrame(page, 'frame1', server.EMPTY_PAGE);
    const frame = page.frames()[1];
    let waitError = null;
    const waitPromise = frame.waitForSelector('//*[@class="box"]').catch(e => waitError = e);
    await utils.detachFrame(page, 'frame1');
    await waitPromise;
    expect(waitError).toBeTruthy();
    expect(waitError.message).toContain('waitForFunction failed: frame got detached.');
  });
  it('should return the element handle', async({page, server}) => {
    const waitForXPath = page.waitForSelector('//*[@class="zombo"]');
    await page.setContent(`<div class='zombo'>anything</div>`);
    expect(await page.evaluate(x => x.textContent, await waitForXPath)).toBe('anything');
  });
  it('should allow you to select an element with single slash', async({page, server}) => {
    await page.setContent(`<div>some text</div>`);
    const waitForXPath = page.waitForSelector('//html/body/div');
    expect(await page.evaluate(x => x.textContent, await waitForXPath)).toBe('some text');
  });
});
