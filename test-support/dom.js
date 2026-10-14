// Minimal DOM contract double, not an HTML parser. Reject parsing sinks so a
// regression cannot pass by silently storing unsafe markup as a string.
export class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.dataset = {}
    this.className = ''
    this.listeners = {}
    this.classList = { add: name => { this.className += ` ${name}` } }
  }
  set innerHTML(_) { throw new Error('HTML parsing sink used') }
  set outerHTML(_) { throw new Error('HTML parsing sink used') }
  insertAdjacentHTML() { throw new Error('HTML parsing sink used') }
  set textContent(value) { this.children = [String(value)] }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('') }
  append(...children) { this.children.push(...children) }
  appendChild(child) { this.append(child); return child }
  replaceChildren(...children) { this.children = [...children] }
  addEventListener(type, listener) { this.listeners[type] = listener }
}

export function domFixture(t) {
  const elements = new Map()
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new Element('div'))
      return elements.get(id)
    },
    querySelectorAll: selector => {
      const all = []
      const visit = node => {
        if (typeof node === 'string') return
        if (node.className.split(' ').includes(selector.slice(1))) all.push(node)
        node.children.forEach(visit)
      }
      elements.forEach(visit)
      return all
    }
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch') })
  const oldDocument = globalThis.document
  const oldWindow = globalThis.window
  globalThis.document = document
  globalThis.window = { location: { href: '' } }
  t.after(() => { globalThis.document = oldDocument; globalThis.window = oldWindow })
  return document
}
