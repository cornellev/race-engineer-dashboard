import logo from "/logo.svg";

export default function Header(props: {
  setSideBar: (open: boolean) => void;
  sideBar: boolean;
  activePage: "live" | "replay";
  onNavigate: (page: "live" | "replay") => void;
}) {
  const navLinkClass = (isActive: boolean) =>
    `border-0 bg-transparent p-0 font-medium transition-colors duration-200 ${
      isActive ? "text-[var(--primary-accent)]" : "text-white"
    }`;

  return (
    <header className="fixed top-0 left-0 right-0 z-100 bg-linear-to-r from-[#232526] to-[#252628] shadow-[0_18px_40px_rgba(0,0,0,0.24)] border-b-white/8">
      <div className="max-w-9xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="Race Engineer Dashboard"
            className="w-8 h-8 sm:w-10 sm:h-10"
          />
          <span className="text-lg font-bold text-white sm:text-xl">
            Race Engineer Dashboard
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex items-center gap-8">
          <a
            type="button"
            className="transition-colors duration-200 font-medium hidden sm:block border-0 bg-transparent p-0"
            onClick={() => {
              props.setSideBar(!props.sideBar);
            }}
            data-testid="tern-toggle"
          >
            Tern
          </a>
          <a
            type="button"
            className={navLinkClass(props.activePage === "replay")}
            onClick={() => {
              props.onNavigate("replay");
            }}
          >
            Replay
          </a>
          <a
            type="button"
            className={navLinkClass(props.activePage === "live")}
            onClick={() => {
              props.onNavigate("live");
            }}
          >
            Live
          </a>
          {/* Hamburger Menu */}
          <label className="swap swap-rotate group">
            {/* this hidden checkbox controls the state */}
            <input
              type="checkbox"
              checked={props.sideBar}
              onClick={() => {
                props.setSideBar(!props.sideBar);
              }}
            />

            {/* hamburger icon */}
            <svg
              className="swap-off fill-current group-hover:fill-(--primary-accent)"
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 512 512"
            >
              <path d="M64,384H448V341.33H64Zm0-106.67H448V234.67H64ZM64,128v42.67H448V128Z" />
            </svg>

            {/* close icon */}
            <svg
              className="swap-on fill-current group-hover:fill-(--primary-accent)"
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 512 512"
            >
              <polygon points="400 145.49 366.51 112 256 222.51 145.49 112 112 145.49 222.51 256 112 366.51 145.49 400 256 289.49 366.51 400 400 366.51 289.49 256 400 145.49" />
            </svg>
          </label>
        </nav>
      </div>
    </header>
  );
}
