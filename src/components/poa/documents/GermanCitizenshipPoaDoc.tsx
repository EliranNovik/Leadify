import React from 'react';
import { PoaField, PoaRadioRow, PoaSignatureBox, type PoaDocController } from '../PoaFormPrimitives';

/** Bordered box with a vertical (rotated) section label on the left, as on the official form. */
const SectionBox: React.FC<{ label: string; caption?: string; children: React.ReactNode }> = ({
  label,
  caption,
  children,
}) => (
  <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-300">
    <div className="flex w-11 shrink-0 items-center justify-center border-r border-gray-300 bg-gray-100">
      <span
        className="whitespace-nowrap text-xs font-bold uppercase tracking-wide text-gray-600"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </span>
    </div>
    <div className="min-w-0 flex-1 p-4">
      {caption && (
        <p className="mb-3 text-xs font-medium italic text-gray-500">{caption}</p>
      )}
      {children}
    </div>
  </div>
);

/**
 * On-screen guidance for a section. On desktop it floats in the grey gutter to
 * the right of the document (outside the white page); on mobile it stacks below
 * the section. Marked `poa-help` so it never appears in the printed document.
 */
const HelpBox: React.FC<{ title: string; tone?: 'info' | 'warn'; children: React.ReactNode }> = ({
  title,
  tone = 'info',
  children,
}) => {
  const styles =
    tone === 'warn'
      ? 'bg-amber-50 text-amber-900'
      : 'bg-indigo-50 text-indigo-900';
  const titleColor = tone === 'warn' ? 'text-amber-700' : 'text-indigo-700';
  return (
    <aside
      className={`poa-help mt-3 rounded-lg p-3 text-[13px] leading-relaxed shadow-sm lg:absolute lg:top-0 lg:left-[calc(100%+4rem)] lg:mt-0 lg:w-60 ${styles}`}
    >
      <p className={`mb-1 text-xs font-bold uppercase tracking-wide ${titleColor}`}>{title}</p>
      <div>{children}</div>
    </aside>
  );
};

/**
 * Wraps a section and its side help box. The wrapper is `relative` so the help
 * box can be absolutely placed in the grey gutter to the right on desktop.
 */
const WithHelp: React.FC<{ help: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  help,
  children,
  className = '',
}) => (
  <div className={`relative ${className}`}>
    {children}
    {help}
  </div>
);

/**
 * German Citizenship POA — Vollmacht to the Bundesverwaltungsamt.
 * Bilingual German / English, faithful to the official August 2021 form.
 */
const GermanCitizenshipPoaDoc: React.FC<{ ctrl: PoaDocController }> = ({ ctrl }) => {
  return (
    <div className="poa-doc text-gray-900">
      {/* Title box — matches the official form's teal "Vollmacht" header */}
      <div className="mb-4 flex justify-end">
        <div className="rounded-2xl bg-[#bcd9dd] px-10 py-4 shadow-sm">
          <span className="font-serif text-4xl font-bold tracking-wide text-gray-900">Vollmacht</span>
        </div>
      </div>

      <header className="mb-4 border-b border-gray-200 pb-3 text-sm leading-snug text-gray-700">
        <p>An das</p>
        <p>Bundesverwaltungsamt</p>
        <p>50728 Köln</p>
        <p>Germany</p>
        <p className="mt-4 text-lg font-bold text-gray-900 sm:text-xl">
          Durchführung von Staatsangehörigkeitsverfahren
        </p>
        <div className="mt-3 max-w-sm">
          <PoaField ctrl={ctrl} id="aktenzeichen" label="Aktenzeichen (file reference)" />
        </div>
      </header>

      <h1 className="mb-3 text-center text-2xl font-bold tracking-wide">Vollmacht</h1>

      <WithHelp
        className="mb-4"
        help={
          <HelpBox title="Applicant — fill this in">
            These are <strong>your</strong> details (the person applying). Enter your last name,
            first name, date of birth, place &amp; country of birth, and your full home address. For
            a minor, enter the <strong>child&apos;s</strong> details here.
          </HelpBox>
        }
      >
        <SectionBox label="Antragstellende Person">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PoaField ctrl={ctrl} id="applicant_last_name" label="Familienname (Last name)" />
            <PoaField ctrl={ctrl} id="applicant_first_name" label="Vorname (First name)" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PoaField ctrl={ctrl} id="applicant_birth_date" label="Geburtsdatum (Date of birth)" type="date" />
            <PoaField ctrl={ctrl} id="applicant_birth_place" label="Geburtsort / Staat (Place of birth)" />
          </div>
          <div className="mt-4">
            <PoaField
              ctrl={ctrl}
              id="applicant_address"
              label="Vollständige Anschrift (Full address)"
              multiline
            />
          </div>
        </SectionBox>
      </WithHelp>

      <WithHelp
        className="mb-4"
        help={
          <HelpBox title="Do not fill in" tone="warn">
            <strong>The law office completes this section.</strong> The authorised representative
            (Herr/Frau, name, address, phone and e-mail) is filled in by Decker, Pex &amp; Co. —
            please leave it blank.
          </HelpBox>
        }
      >
        <div className="mb-4">
          <PoaRadioRow
            ctrl={ctrl}
            id="salutation"
            options={[
              { value: 'Herr', label: 'Herr (Mr.)' },
              { value: 'Frau', label: 'Frau (Mrs.)' },
            ]}
          />
        </div>

        <SectionBox label="Bevollmächtigte Person">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PoaField ctrl={ctrl} id="rep_last_name" label="Name (Last name)" />
            <PoaField ctrl={ctrl} id="rep_first_name" label="Vorname (First name)" />
          </div>
          <div className="mt-4">
            <PoaField
              ctrl={ctrl}
              id="rep_address"
              label="Vollständige Anschrift (Straße, Haus-Nr., PLZ, Ort / Staat)"
              multiline
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PoaField ctrl={ctrl} id="rep_phone" label="Telefonnummer" type="tel" />
            <PoaField ctrl={ctrl} id="rep_email" label="E-Mail" type="email" />
          </div>
        </SectionBox>
      </WithHelp>

      <p className="mb-4 text-[15px] leading-snug">
        wird von mir (für mein minderjähriges Kind) in allen Staatsangehörigkeitsverfahren
        bevollmächtigt. Die Vollmacht gilt für alle damit verbundenen Verfahrenshandlungen,
        einschließlich der Antragstellung, der Abgabe von Erklärungen, der Entgegennahme von
        Bescheiden und der Durchführung eines Widerspruchsverfahrens.
      </p>

      <WithHelp
        className="mb-4"
        help={
          <HelpBox title="Place, date &amp; signature">
            Enter the <strong>place and date</strong> (e.g. &ldquo;Tel Aviv, 22.06.2026&rdquo;), then
            sign in the box. The <strong>applicant / first parent</strong> signs on the left. A{' '}
            <strong>second legal guardian (parent)</strong> signs on the right — only needed for a
            minor with two guardians.
          </HelpBox>
        }
      >
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <PoaField ctrl={ctrl} id="place_date_1" label="Ort, Datum" />
            <div className="mt-3">
              <PoaSignatureBox ctrl={ctrl} id="signature_first_parent" label="Unterschrift" />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-gray-700">
              Unterschrift der antragstellenden Person oder der ersten gesetzlichen Vertretung -{' '}
              <span className="bg-yellow-200 font-semibold">Applicant / First parent needs to sign here</span>
            </p>
          </div>
          <div>
            <PoaField ctrl={ctrl} id="place_date_2" label="Ort, Datum" />
            <div className="mt-3">
              <PoaSignatureBox ctrl={ctrl} id="signature_second_parent" label="Unterschrift" />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-gray-700">
              Unterschrift der zweiten gesetzlichen Vertretung -{' '}
              <span className="bg-yellow-200 font-semibold">Second parent needs to sign Here</span>
            </p>
          </div>
        </section>
      </WithHelp>

      {/* Hinweise box — teal background as in the official form */}
      <section className="rounded-2xl bg-[#bcd9dd] p-5 text-[13px] leading-relaxed text-gray-800">
        <p className="mb-2 font-semibold text-gray-900">Hinweise:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Bei minderjährigen Kindern unter 16 Jahren müssen die sorgeberechtigten Eltern (bzw.
            andere Personen, die die gesetzliche Vertretung ausüben) unterschreiben.
          </li>
          <li>
            Minderjährige ab 16 Jahre stellen einen eigenen Antrag und unterschreiben daher die
            Vollmacht selbst.
          </li>
          <li>
            Sie können die Vollmacht jederzeit schriftlich widerrufen. Das Verfahren wird dann über
            die zuständige deutsche Auslandsvertretung mit Ihnen persönlich weitergeführt.
          </li>
        </ul>
      </section>

      <p className="mt-5 text-right text-[11px] text-gray-500">
        Bundesverwaltungsamt, Stand: August 2021
      </p>
    </div>
  );
};

export default GermanCitizenshipPoaDoc;
