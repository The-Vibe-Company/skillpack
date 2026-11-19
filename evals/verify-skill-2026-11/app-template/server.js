const http = require('node:http');

const PORT = process.env.PORT || 3000;
const item = { id: 'mug', name: 'Coffee mug', price: 10 };
let cart = [];
let nextOrder = 1001;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    return send(res, 200, page('Tiny Shop', `
      <h1>Tiny Shop</h1>
      <p>${item.name}: $${item.price}</p>
      <form method="POST" action="/cart">
        <input type="hidden" name="item" value="${item.id}">
        <button type="submit">Add to cart</button>
      </form>
      <p>Cart: ${cart.length} item(s)</p>`));
  }
  if (req.method === 'POST' && req.url === '/cart') {
    const form = await readBody(req);
    if (form.get('item') !== item.id) return send(res, 400, page('Error', '<p>Unknown item</p>'));
    cart.push(item);
    return send(res, 200, page('Cart', `<p>Added ${item.name}. Cart: ${cart.length} item(s)</p>
      <form method="POST" action="/checkout"><input name="card" value="4242424242424242"><button>Checkout</button></form>`));
  }
  if (req.method === 'POST' && req.url === '/checkout') {
    const form = await readBody(req);
    if (cart.length === 0) return send(res, 400, page('Error', '<p>Cart is empty</p>'));
    if (form.get('card') !== '4242424242424242') return send(res, 402, page('Error', '<p>Card declined</p>'));
    const order = nextOrder++;
    cart = [];
    return send(res, 200, page('Confirmed', `<h1>Thank you!</h1><p>Order #${order} confirmed.</p>`));
  }
  send(res, 404, page('Not found', '<p>Not found</p>'));
});

server.listen(PORT, () => console.log(`Tiny Shop listening on http://localhost:${PORT}`));
