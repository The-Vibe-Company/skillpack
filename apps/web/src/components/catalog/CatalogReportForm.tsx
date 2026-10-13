"use client";

import { useId, useState, type FormEvent } from "react";
import { publicCatalogReportApiPath } from "@/lib/publicCatalog";

const REPORT_REASONS = [
  { value: "secret_exposure", label: "Secret exposé" },
  { value: "malicious", label: "Malveillant" },
  { value: "license", label: "Licence" },
  { value: "spam", label: "Spam" },
] as const;

type ReportState = "idle" | "submitting" | "success";

function errorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Le signalement est incomplet. Vérifiez le motif choisi et réessayez.";
    case 404:
      return "Cette compétence n’est plus disponible dans le catalogue.";
    case 429:
      return "Trop de signalements ont été reçus. Réessayez plus tard.";
    case 503:
      return "Le service de signalement est temporairement indisponible. Réessayez plus tard.";
    default:
      return "Le signalement n’a pas pu être envoyé. Réessayez.";
  }
}

export function CatalogReportForm({ orgSlug, skillSlug }: { orgSlug: string; skillSlug: string }) {
  const id = useId();
  const reasonId = `${id}-reason`;
  const detailsId = `${id}-details`;
  const hintId = `${id}-hint`;
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<ReportState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;
    setError(null);
    setState("submitting");
    const trimmedDetails = details.trim();
    const payload = trimmedDetails ? { reason, details: trimmedDetails } : { reason };

    try {
      const response = await fetch(publicCatalogReportApiPath(orgSlug, skillSlug), {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setError(errorMessage(response.status));
        setState("idle");
        return;
      }
      setState("success");
    } catch {
      setError(errorMessage(0));
      setState("idle");
    }
  }

  return (
    <details className="v10-catskill__report">
      <summary>Signaler</summary>
      {state === "success" ? (
        <p className="v10-catskill__report-success" role="status">
          Merci, votre signalement a été transmis. Stan l’examinera sous 48 heures.
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} data-report-state={state}>
          <p className="v10-catskill__report-intro">
            Signalez un problème dans cette compétence. Aucun compte n’est nécessaire.
          </p>
          <div className="v10-catskill__report-field">
            <label htmlFor={reasonId}>Motif</label>
            <select
              id={reasonId}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              disabled={state === "submitting"}
              aria-describedby={hintId}
            >
              <option value="">Choisir un motif</option>
              {REPORT_REASONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="v10-catskill__report-hint" id={hintId}>Choisissez la raison qui décrit le mieux le problème.</p>
          </div>
          <div className="v10-catskill__report-field">
            <label htmlFor={detailsId}>Détails (facultatif)</label>
            <textarea
              id={detailsId}
              name="details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={2000}
              disabled={state === "submitting"}
              aria-describedby={`${detailsId}-privacy ${detailsId}-count`}
            />
            <p className="v10-catskill__report-hint" id={`${detailsId}-privacy`}>Décrivez le problème sans copier de secrets.</p>
            <p className="v10-catskill__report-count" id={`${detailsId}-count`}>{details.length}/2000</p>
          </div>
          {error ? <p className="v10-catskill__report-error" role="alert">{error}</p> : null}
          <div className="v10-catskill__report-actions">
            <span className="v10-catskill__report-hint" role="status" aria-live="polite">
              {state === "submitting" ? "Envoi du signalement…" : ""}
            </span>
            <button className="v10-catskill__report-submit" type="submit" disabled={state === "submitting"}>
              {state === "submitting" ? "Envoi…" : "Envoyer le signalement"}
            </button>
          </div>
        </form>
      )}
    </details>
  );
}
