import InteractiveGrid from "../layouts/InteractiveGrid";
import StaleTelemetryBanner from "../components/StaleTelemetryBanner";
import type { SocketData } from "../utils/Socket";

export default function Data({ data }: { data: SocketData[] }) {
  return (
    <section className="h-[min(92.5vh,calc(100vh-67px))] w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <StaleTelemetryBanner />
      <InteractiveGrid data={data} />
    </section>
  );
}
