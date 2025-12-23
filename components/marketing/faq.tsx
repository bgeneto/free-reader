"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTranslations } from "next-intl";

export function FAQ() {
  const t = useTranslations("faq");
  const siteUrl = process.env.NEXT_PUBLIC_URL || "http://smry.ai";
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "SMRY";

  const faqData = [
    { question: t("q1"), answer: t("a1", { siteName }) },
    { question: t("q2"), answer: t("a2", { siteName }) },
    { question: t("q3", { siteName }), answer: t("a3", { siteName }) },
    {
      question: t("q4", { siteName }),
      answer: (
        <>
          {t("a4", { siteName })}{" "}
          <a
            href="https://github.com/bgeneto/free-reader"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            https://github.com/bgeneto/free-reader
          </a>
          .
        </>
      ),
    },
    { question: t("q5"), answer: t("a5") },
    { question: t("q6"), answer: t("a6") },
    { question: t("q7"), answer: t("a7") },
    {
      question: t("q8", { siteName }),
      answer: (
        <>
          {t("a8")}
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              {t("a8Option1", {
                code: `${siteUrl}/`,
                example: `${siteUrl}/https://www.wsj.com/...`
              }).split("{code}").map((part, i) =>
                i === 0 ? part : (
                  <span key={i}>
                    <code className="rounded bg-yellow-100 px-1 py-0.5 font-mono text-xs text-neutral-800 dark:bg-yellow-900 dark:text-neutral-200">
                      {siteUrl}/
                    </code>
                    {part}
                  </span>
                )
              )}
            </li>
            <li>{t("a8Option2", { siteUrl })}</li>
            <li>{t("a8Option3", { siteName })}</li>
          </ol>
        </>
      ),
    },
    { question: t("q9", { siteName }), answer: t("a9", { siteName }) },
  ];

  return (
    <div className="mx-auto mt-16 w-full max-w-3xl">
      {/* Editorial Section Header */}
      <div className="text-center mb-10">
        <div className="flex items-center justify-center gap-4 mb-3">
          <div className="h-px w-12 bg-border" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("title")}</span>
          <div className="h-px w-12 bg-border" />
        </div>
      </div>
      <Accordion type="single" collapsible className="w-full">
        {faqData.map((item, index) => (
          <AccordionItem key={index} value={`item-${index}`}>
            <AccordionTrigger className="text-left font-medium italic text-foreground">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* <div className="mt-12 space-y-2 text-center">
        <p className="text-muted-foreground">
          {t("feedbackPrompt")}{" "}
          <a
            href="https://smryai.userjot.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent hover:underline dark:text-accent"
          >
            {t("shareThoughts")}
          </a>
        </p>
        <p className="text-sm text-muted-foreground">
          {t("sponsorships")}{" "}
          <a
            href="mailto:contact@smry.ai"
            className="font-medium text-accent hover:underline dark:text-accent"
          >
            contact@smry.ai
          </a>
        </p>
      </div> */}
    </div>
  );
}

