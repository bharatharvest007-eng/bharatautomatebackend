import { Router } from 'express';
import * as models from '../models/index.js';
import { FlowEngine } from '../services/flowEngine.js';

/**
 * The embeddable website chat widget — the one channel here with zero Meta
 * dependency. A visitor's message flows through the exact same automation
 * engine as WhatsApp/Instagram/Facebook (keyword triggers, AI replies, lead
 * capture nodes all just work), it's simply addressed to a synthetic
 * `SocialAccount` row that represents "this org's website" instead of a real
 * platform account.
 *
 * There is no push channel to an anonymous browser tab without WebSockets
 * (which this backend doesn't run), so replies are delivered by polling —
 * `GET /conversation/:sessionId` — rather than pushed. That is an honest,
 * deliberate trade-off for a first version, not an oversight.
 */

const router = Router();

/** One synthetic account per org represents "the website widget" as a channel. */
async function ensureWidgetAccount(orgId: string) {
  const accountId = `acc_widget_${orgId}`;
  return models.SocialAccount.findOneAndUpdate(
    { _id: accountId },
    {
      $set: { platform: 'widget', username: 'website', name: 'Website Widget', status: 'active' },
      $setOnInsert: { orgId, accessToken: 'n/a', connectedAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
}

/** A visitor sends a message. `sessionId` is a random id the widget script generates and keeps in localStorage. */
router.post('/:orgId/message', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { sessionId, text, name } = req.body;
    if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text are required' });

    const account = await ensureWidgetAccount(orgId);

    const result = await FlowEngine.processMessage({
      platform: 'widget',
      accountExternalId: account._id,
      senderId: String(sessionId).slice(0, 80),
      senderName: name,
      text: String(text).slice(0, 2000),
      timestamp: new Date(),
    });

    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** Poll for the full thread so far — the widget script calls this every few seconds. */
router.get('/:orgId/conversation/:sessionId', async (req, res) => {
  try {
    const { orgId, sessionId } = req.params;
    const accountId = `acc_widget_${orgId}`;

    const contact = await models.Contact.findOne({ accountId, igsid: sessionId });
    if (!contact) return res.json({ ok: true, messages: [] });

    const conversation = await models.Conversation.findOne({ accountId, contactId: contact._id });
    if (!conversation) return res.json({ ok: true, messages: [] });

    const messages = await models.Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(200)
      .select('direction text type createdAt payload');

    await models.Conversation.updateOne({ _id: conversation._id }, { $set: { unreadCount: 0, isRead: true } });

    return res.json({ ok: true, messages });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/** The embeddable script itself — a business embeds this with one <script> tag. */
router.get('/embed.js', (req, res) => {
  const orgId = String(req.query.org || '');
  res.setHeader('Content-Type', 'application/javascript');
  res.send(buildWidgetScript(orgId, req));
});

function buildWidgetScript(orgId: string, req: any): string {
  const base = `${req.protocol}://${req.get('host')}/api/widget`;
  // A small, dependency-free floating chat bubble. Deliberately plain — this
  // is meant to be themed by whoever embeds it, not a polished product widget.
  return `(function(){
  var ORG=${JSON.stringify(orgId)}, BASE=${JSON.stringify(base)};
  var sid = localStorage.getItem('sma_widget_sid');
  if(!sid){ sid = 'w_'+Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('sma_widget_sid', sid); }

  var btn=document.createElement('button');
  btn.textContent='💬'; btn.style.cssText='position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:28px;background:#ec4899;color:#fff;border:none;font-size:24px;cursor:pointer;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  var panel=document.createElement('div');
  panel.style.cssText='position:fixed;bottom:86px;right:20px;width:320px;height:420px;background:#0f172a;border:1px solid #1e293b;border-radius:16px;display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif';
  var log=document.createElement('div');
  log.style.cssText='flex:1;overflow-y:auto;padding:12px;font-size:13px;color:#e2e8f0';
  var form=document.createElement('form');
  form.style.cssText='display:flex;border-top:1px solid #1e293b';
  var input=document.createElement('input');
  input.placeholder='Type a message...'; input.style.cssText='flex:1;border:none;background:transparent;color:#fff;padding:10px;outline:none';
  var send=document.createElement('button'); send.type='submit'; send.textContent='➤'; send.style.cssText='border:none;background:transparent;color:#ec4899;padding:0 14px;cursor:pointer';
  form.appendChild(input); form.appendChild(send);
  panel.appendChild(log); panel.appendChild(form);
  document.body.appendChild(btn); document.body.appendChild(panel);

  function render(msgs){
    log.innerHTML='';
    msgs.forEach(function(m){
      var row=document.createElement('div');
      row.style.cssText='margin:6px 0;display:flex;justify-content:'+(m.direction==='out'?'flex-start':'flex-end');
      var bub=document.createElement('div');
      bub.textContent=m.text||'';
      bub.style.cssText='max-width:80%;padding:8px 12px;border-radius:12px;background:'+(m.direction==='out'?'#1e293b':'#ec4899')+';color:#fff';
      row.appendChild(bub); log.appendChild(row);
    });
    log.scrollTop=log.scrollHeight;
  }

  function poll(){
    fetch(BASE+'/'+ORG+'/conversation/'+sid).then(function(r){return r.json()}).then(function(d){ if(d.ok) render(d.messages||[]); }).catch(function(){});
  }

  btn.onclick=function(){ panel.style.display = panel.style.display==='none'||!panel.style.display ? 'flex' : 'none'; if(panel.style.display==='flex') poll(); };
  form.onsubmit=function(e){
    e.preventDefault();
    var text=input.value.trim(); if(!text) return;
    input.value='';
    fetch(BASE+'/'+ORG+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,text:text})})
      .then(poll);
  };
  setInterval(function(){ if(panel.style.display==='flex') poll(); }, 4000);
})();`;
}

export default router;
