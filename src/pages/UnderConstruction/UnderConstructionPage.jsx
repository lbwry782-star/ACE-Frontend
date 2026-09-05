import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import "./UnderConstructionPage.css";

const bgVideo = `${import.meta.env.BASE_URL}assets/${encodeURIComponent("ווידאו_פתיחה.mp4")}`;
const TERMS_PDF_URL = `${import.meta.env.BASE_URL}assets/ACE_TERMS_AND_POLICIES.pdf?v=20260519`;
const OPENING_PREVIEW1_URL = "https://ace-advertising.agency/#/preview1";
const OPENING_PREVIEW2_URL = "https://ace-advertising.agency/#/preview2";

export default function UnderConstructionPage() {
    const location = useLocation();
    const aceMessage = location.state?.aceMessage ?? null;
    const [isChecked33, setIsChecked33] = useState(false);

  useEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;

    app.classList.add("app--opening-screen");

    const header = app.querySelector(".header");
    let spacer = app.querySelector(".under-construction-header-spacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.className = "under-construction-header-spacer";
      spacer.setAttribute("aria-hidden", "true");
      if (header) {
        app.insertBefore(spacer, header);
      } else {
        app.prepend(spacer);
      }
    }

    return () => {
      app.classList.remove("app--opening-screen");
      spacer.remove();
    };
  }, []);

  return (
    <div className="uc-page">
      {aceMessage ? (
        <p className="uc-safe-message" dir="rtl" role="status">
          {aceMessage}
        </p>
      ) : null}
      <video
        className="uc-video"
        src={bgVideo}
        autoPlay
        loop
        muted
        playsInline
      />
      <div className="uc-image-block">
        <div className="opening-hero-column">
          <div className="opening-image-11-wrap">
            <img
              src="/assets/11.png?v=3"
              className="opening-image-11"
              alt="main"
            />
          </div>
          <div className="opening-row-below-11">
            <div className="uc-image-row">
              <img src="/assets/22.png?v=2" alt="" />
              <div
                className="uc-checkbox"
                onClick={() => setIsChecked33((prev) => !prev)}
              >
                <img src="/assets/33.png?v=2" alt="" />
                {isChecked33 && (
                  <div className="uc-checkmark">✔</div>
                )}
              </div>
              <img src="/assets/44.png?v=2" alt="" />
              <div
                className="uc-hover uc-clickable"
                onClick={() => {
                  window.open(TERMS_PDF_URL, "_blank", "noopener,noreferrer");
                }}
              >
                <img src="/assets/55.png?v=2" className="uc-default" alt="" />
                <img src="/assets/100.png?v=2" className="uc-hover-img" alt="" />
              </div>
            </div>
          </div>
          <img src="/assets/66.png?v=2" className="uc-image-66" alt="" />
          <div className="opening-row-66-wrap">
            <div className="uc-image-row-66-center">
              <div
                className={`uc-hover ${!isChecked33 ? "uc-cursor-blocked" : ""}`}
                onClick={() => {
                  if (!isChecked33) return;
                  window.location.href = OPENING_PREVIEW2_URL;
                }}
              >
                <img src="/assets/77.png?v=2" className="uc-default" alt="" />
                <img src="/assets/101.png?v=2" className="uc-hover-img" alt="" />
              </div>
              <img src="/assets/88.png?v=2" alt="" />
              <div
                className={`uc-hover ${!isChecked33 ? "uc-cursor-blocked" : ""}`}
                onClick={() => {
                  if (!isChecked33) return;
                  window.location.href = OPENING_PREVIEW1_URL;
                }}
              >
                <img src="/assets/99.png?v=2" className="uc-default" alt="" />
                <img src="/assets/102.png?v=2" className="uc-hover-img" alt="" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}