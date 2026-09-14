"use client";

import { useState } from "react";
import type { Branding, Estimate } from "../lib/types";

export function WeeklyUpdate({ estimate, branding }: { estimate: Estimate; branding: Branding }) {
  const [recipients, setRecipients] = useState("");
  const [progress, setProgress] = useState("");
  const [risks, setRisks] = useState("");
  const [next, setNext] = useState("");
  const team = branding.workspaceName || branding.orgName;
  const subject = `POC weekly update — ${estimate.customer || "Customer"}`;
  const body = `Hello,\n\nHere is this week's POC update.\n\nCOMPLETED\n${progress}\n\nRISKS / DECISIONS\n${risks}\n\nNEXT WEEK\n${next}\n\nRegards,\n${team}`;
  const href = `mailto:${encodeURIComponent(recipients)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipients)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="content">
      <div className="title-row"><div><span className="eyebrow">WEEKLY UPDATE</span><h1>Keep everyone aligned</h1><p>Compose a crisp stakeholder update, then open it in your mail client.</p></div></div>
      <div className="update-grid">
        <div className="editor-panel">
          <label>Recipients<input placeholder="account-team@example.com, customer@example.com" value={recipients} onChange={(event) => setRecipients(event.target.value)} /></label>
          <label>Completed this week<textarea value={progress} onChange={(event) => setProgress(event.target.value)} /></label>
          <label>Risks, blockers, or decisions<textarea value={risks} onChange={(event) => setRisks(event.target.value)} /></label>
          <label>Next week<textarea value={next} onChange={(event) => setNext(event.target.value)} /></label>
          <div className="row-actions">
            <a className="primary link-button" href={href}>Open in mail client</a>
            <a className="secondary link-button" href={gmail} target="_blank" rel="noreferrer">Open in Gmail ↗</a>
          </div>
        </div>
        <div className="mail-preview">
          <div className="mail-meta"><span>TO</span><b>{recipients || "—"}</b><span>SUBJECT</span><b>{subject}</b></div>
          <div className="mail-body">Hello,<br /><br />Here is this week&apos;s POC update.<Block title="COMPLETED" text={progress} /><Block title="RISKS / DECISIONS" text={risks} /><Block title="NEXT WEEK" text={next} /><br />Regards,<br /><b>{team}</b></div>
        </div>
      </div>
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return <div className="update-block"><b>{title}</b><p className={text ? "" : "placeholder-copy"}>{text || "Nothing yet."}</p></div>;
}
