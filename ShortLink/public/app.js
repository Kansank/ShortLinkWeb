const form = document.querySelector('#link-form');
const message = document.querySelector('#message');
const list = document.querySelector('#links');
const template = document.querySelector('#link-template');

const shortUrl = code => `${location.origin}/${code}`;
function setMessage(text, isError = false) { message.textContent = text; message.className = isError ? 'error' : 'success'; }

async function loadLinks() {
  const response = await fetch('/api/links');
  const links = await response.json();
  list.replaceChildren();
  if (!links.length) { list.innerHTML = '<p class="empty">ยังไม่มีลิงก์ ลองสร้างลิงก์แรกของคุณได้เลย</p>'; return; }
  links.forEach(link => {
    const item = template.content.cloneNode(true);
    item.querySelector('.title').textContent = link.title || link.code;
    const short = item.querySelector('.short'); short.href = shortUrl(link.code); short.textContent = shortUrl(link.code);
    item.querySelector('.destination').textContent = link.url;
    item.querySelector('.clicks').textContent = `${link.clicks} คลิก`;
    item.querySelector('.copy').onclick = async () => { await navigator.clipboard.writeText(shortUrl(link.code)); setMessage('คัดลอกลิงก์แล้ว'); };
    item.querySelector('.delete').onclick = async () => { if (!confirm(`ลบ ${link.code} ใช่ไหม?`)) return; await fetch(`/api/links/${encodeURIComponent(link.code)}`, { method: 'DELETE' }); loadLinks(); };
    list.append(item);
  });
}

form.onsubmit = async event => {
  event.preventDefault(); setMessage('กำลังบันทึก…');
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return setMessage(result.error || 'บันทึกไม่สำเร็จ', true);
  form.reset(); setMessage(`สร้างแล้ว: ${shortUrl(result.code)}`); loadLinks();
};
document.querySelector('#refresh').onclick = loadLinks;
loadLinks();
