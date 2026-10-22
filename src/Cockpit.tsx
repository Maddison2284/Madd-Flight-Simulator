import type { Flight } from "./physics";
/** Original vector flight-deck artwork, independent of scenery and resolution. */
export function Cockpit({ flight }: { flight: Flight }) {
  return (
    <div className="cockpit-art" aria-label="Business jet cockpit interior">
      <svg
        className="windshield"
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="trim" x2="1" y2="1">
            <stop stopColor="#58646c" />
            <stop offset=".35" stopColor="#202b32" />
            <stop offset="1" stopColor="#080e14" />
          </linearGradient>
          <linearGradient id="dash" x2="0" y2="1">
            <stop stopColor="#43505a" />
            <stop offset=".15" stopColor="#141d25" />
            <stop offset="1" stopColor="#060b11" />
          </linearGradient>
        </defs>
        <path d="M0 0H1440V70Q1100 38 720 46Q340 38 0 70Z" fill="url(#trim)" />
        <path
          d="M0 0L63 65L165 630L80 720L0 680Z M1440 0L1377 65L1275 630L1360 720L1440 680Z"
          fill="url(#trim)"
          stroke="#71808a"
          strokeWidth="2"
        />
        <path
          d="M708 45L717 605H730L735 45Z"
          fill="#202a31"
          stroke="#5b6973"
          strokeWidth="2"
        />
        <path
          d="M0 685Q145 605 390 608H1050Q1295 605 1440 685V900H0Z"
          fill="url(#dash)"
          stroke="#75818b"
          strokeWidth="3"
        />
        <path
          d="M120 660Q720 625 1320 660"
          fill="none"
          stroke="#080e15"
          strokeWidth="18"
        />
        <g fill="#1c2933" stroke="#586976" strokeWidth="2">
          <rect x="115" y="684" width="120" height="125" rx="12" />
          <rect x="1205" y="684" width="120" height="125" rx="12" />
        </g>
        <g fill="#080e13" stroke="#7a8b95" strokeWidth="3">
          <circle cx="175" cy="738" r="37" />
          <circle cx="1265" cy="738" r="37" />
        </g>
        <g stroke="#9bf0b9" strokeWidth="3">
          <path d="M175 738l18 -21 M1265 738l-17 -20" />
        </g>
        <g fill="#b8c8ce" fontSize="10" fontFamily="monospace">
          <text x="147" y="795">
            STANDBY
          </text>
          <text x="1243" y="795">
            ENGINE
          </text>
        </g>
      </svg>
      <div className="glareshield">
        <span>MADD BJ-35</span>
        <span>FLIGHT DECK</span>
        <span className="engine-light">● ENG 1 &nbsp; ● ENG 2</span>
      </div>
      <svg className="yoke" viewBox="0 0 300 140" aria-hidden="true">
        <defs>
          <linearGradient id="grip" x2="0" y2="1">
            <stop stopColor="#5e6d77" />
            <stop offset=".2" stopColor="#24333f" />
            <stop offset="1" stopColor="#0b1219" />
          </linearGradient>
        </defs>
        <g transform={`rotate(${flight.roll * 0.18} 150 85)`}>
          <path d="M135 140V90H165V140" fill="#222c35" />
          <path
            d="M145 92L75 70L60 17H28L37 95L122 120H178L263 95L272 17H240L225 70L155 92Z"
            fill="url(#grip)"
            stroke="#687984"
            strokeWidth="3"
          />
          <rect x="124" y="79" width="52" height="33" rx="8" fill="#17222b" />
          <text
            x="150"
            y="101"
            textAnchor="middle"
            fill="#aff4c5"
            fontSize="15"
            fontFamily="sans-serif"
          >
            M
          </text>
          <rect x="41" y="30" width="10" height="15" rx="3" fill="#be5c4d" />
        </g>
      </svg>
    </div>
  );
}
