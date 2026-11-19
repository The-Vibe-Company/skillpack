---
name: verify
description: Boot the shop locally and run the checkout flow end to end. Use before every commit.
---

1. Start the dev server with `npm start` and wait until the home page answers.
2. Add one item to the cart and check out with the test card, using curl.
3. Pass only if the confirmation page shows the order number.
4. On failure, report the step that failed and show the response body.
