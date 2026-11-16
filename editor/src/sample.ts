/** The note shown in demo mode. It is the "Weekly review" note of the design mockup. */
export const SAMPLE_NOTE = `---
type: review
week: 46
status: open
---

# Weekly review

Notes from Monday's call. The open points are in [[Content calendar]].

## This week

- [x] Send the invoice
- [ ] Draft the launch thread
- [ ] Check the banner sizes with **Mara**

## Posts

| Post          | Channel | Status |
| ------------- | ------- | ------ |
| Launch thread | X       | Draft  |
| Server banner | Discord | Ready  |
| October recap | Blog    | Idea   |

## Later

> Ask about the *newsletter* budget before the next call.

- Read the [style guide](https://example.com/style) again
- Try \`inline code\` and ~~old ideas~~

\`\`\`
plain code block
\`\`\`
`;

/** An HTML note for the demo: styled, with a script, a link within the page and one to the web. */
export const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Garden plan</title>
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 20px; color: #2b3a2e; background: #f4f7f1; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .beds { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
  .bed { background: #fff; border: 1px solid #cfdcc8; border-radius: 10px; padding: 10px 12px; }
  .bed b { display: block; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #5c7f52; background: #e3eedd; }
</style>
</head>
<body>
<h1>Garden plan</h1>
<p>Spring planting, four beds. <a href="#water">Watering</a> is below.</p>
<div class="beds">
  <div class="bed"><b>North</b>Peas, lettuce</div>
  <div class="bed"><b>South</b>Tomatoes, basil</div>
  <div class="bed"><b>East</b>Carrots, radish</div>
  <div class="bed"><b>West</b>Beans, marigolds</div>
</div>
<p>Seeds watered: <span id="count">0</span> <button id="water-btn" type="button">Water</button></p>
<h2 id="water">Watering</h2>
<p>Every second evening. Spacing guide at <a href="https://example.com/spacing">example.com</a>.</p>
<script>
  let n = 0;
  document.getElementById("water-btn").addEventListener("click", () => {
    document.getElementById("count").textContent = String(++n);
  });
</script>
</body>
</html>
`;

export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="192" height="192">
  <rect width="96" height="96" rx="22" fill="#F1DCC4"/>
  <path d="M54 20H43a17 17 0 0 0 0 34h3v24h8z" fill="#34322C"/>
  <rect x="63" y="15" width="7" height="66" rx="3.5" fill="#C15F3C"/>
</svg>
`;

export const SAMPLE_CSV = `Item,Category,Cost,Paid
Tent,Camping,120.00,yes
Stove,Camping,"1,045.50",no
"Rain jacket, red",Clothes,89.90,yes
Train tickets,Travel,64.00,yes
Snacks,Food,23.75,no
`;
