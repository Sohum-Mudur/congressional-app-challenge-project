import ReportApp from "@/components/ClientReportApp";

export default async function Home(props: PageProps<"/">) {
  const { signal } = await props.searchParams;
  return (
    <main className="flex flex-1 flex-col">
      <ReportApp initialSignalId={typeof signal === "string" ? signal : null} />
    </main>
  );
}
