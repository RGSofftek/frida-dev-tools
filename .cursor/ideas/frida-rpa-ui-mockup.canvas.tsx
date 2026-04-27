import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, Pill, Row, Stack, Text, useHostTheme } from "cursor/canvas";

function TerminalChrome({ children, title, trailing }: { children: any; title: string; trailing?: any }) {
  const theme = useHostTheme();
  return (
    <div
      style={{
        background: theme.bg.chrome,
        color: theme.text.primary,
        border: `1px solid ${theme.stroke.primary}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "9px 14px",
          borderBottom: `1px solid ${theme.stroke.secondary}`,
          background: theme.bg.elevated,
        }}
      >
        <Row justify="space-between" align="center">
          <Text weight="semibold">{title}</Text>
          {trailing ?? <Pill tone="info" size="sm">terminal mock</Pill>}
        </Row>
      </div>
      {children}
    </div>
  );
}

function BigFridaBanner() {
  const theme = useHostTheme();
  const fridaPink = theme.diff.stripRemoved;
  const bannerRows = [
    "███████╗██████╗ ██╗██████╗  █████╗     ██████╗ ██████╗  █████╗",
    "██╔════╝██╔══██╗██║██╔══██╗██╔══██╗    ██╔══██╗██╔══██╗██╔══██╗",
    "█████╗  ██████╔╝██║██║  ██║███████║    ██████╔╝██████╔╝███████║",
    "██╔══╝  ██╔══██╗██║██║  ██║██╔══██║    ██╔══██╗██╔═══╝ ██╔══██║",
    "██║     ██║  ██║██║██████╔╝██║  ██║    ██║  ██║██║     ██║  ██║",
    "╚═╝     ╚═╝  ╚═╝╚═╝╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝",
  ];
  const glyphColor = (index: number, length: number) => {
    const ratio = length <= 1 ? 0 : index / (length - 1);
    if (ratio < 0.7) return fridaPink;
    if (ratio < 0.88) return theme.text.secondary;
    return theme.text.primary;
  };

  return (
    <Stack gap={8}>
      <div
        style={{
          fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace",
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 800,
          whiteSpace: "pre",
          overflowX: "auto",
        }}
      >
        {bannerRows.map((row, rowIndex) => (
          <div key={rowIndex}>
            <span style={{ color: fridaPink }}>{rowIndex < bannerRows.length - 1 ? ">" : " "}</span>
            <span>  </span>
            {row.split("").map((char, charIndex) => (
              <span key={charIndex} style={{ color: glyphColor(charIndex, row.length) }}>{char}</span>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          color: theme.text.primary,
          fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace",
          letterSpacing: 5,
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        DEVELOPMENT CLI
      </div>
      <div style={{ height: 6, width: "100%", background: fridaPink, opacity: 0.95 }} />
    </Stack>
  );
}

function Tips() {
  const theme = useHostTheme();
  return (
    <div style={{ color: theme.text.secondary, fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ color: theme.text.primary }}>Tips for getting started:</div>
      <div>1. Run <span style={{ color: theme.diff.stripRemoved }}>lint</span> before editing remote files.</div>
      <div>2. Use <span style={{ color: theme.diff.stripRemoved }}>push</span> to format, fix safely, lint, and upload.</div>
      <div>3. Use <span style={{ color: theme.diff.stripRemoved }}>open .</span> to reload this folder in VS Code.</div>
      <div>4. Type <span style={{ color: theme.diff.stripRemoved }}>help</span> for every command.</div>
    </div>
  );
}

function StatusGrid() {
  const theme = useHostTheme();
  const rows = [
    ["Folder", "C:\\FRIDA\\TuringExpo\\Local\\3950444\\0"],
    ["Process", "3950444"],
    ["Step", "0"],
    ["Cognitive", "Signed in as rodrigo@example.com"],
    ["Git", "Local changes detected"],
    ["Lint", "Not checked this session"],
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "96px minmax(0, 1fr)",
        columnGap: 18,
        rowGap: 7,
        fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace",
        fontSize: 13,
      }}
    >
      {rows.map(([label, value], index) => (
        <div key={index} style={{ display: "contents" }}>
          <div style={{ color: theme.text.tertiary }}>{label}</div>
          <div style={{ color: theme.text.secondary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function PromptLine({ command }: { command: string }) {
  const theme = useHostTheme();
  return (
    <div style={{ color: theme.text.tertiary, fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 13 }}>
      <span style={{ color: theme.diff.stripRemoved }}>{">"}</span> {command}
    </div>
  );
}

function ResultBox() {
  const theme = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.stroke.primary}`,
        borderRadius: 6,
        padding: 12,
        fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace",
        color: theme.text.secondary,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ color: theme.text.primary, fontWeight: 700 }}>Lint result</div>
      <div>Checked       Actions.txt and RunScript targets</div>
      <div>Status        Clean</div>
      <br />
      <div style={{ color: theme.diff.stripRemoved }}>No blocking FRIDA issues found.</div>
    </div>
  );
}

function MainTerminal() {
  const theme = useHostTheme();
  return (
    <TerminalChrome title="FRIDA RPA terminal" trailing={<Pill tone="success" size="sm">session ready</Pill>}>
      <div style={{ padding: 24 }}>
        <Stack gap={20}>
          <BigFridaBanner />
          <Tips />
          <Divider />
          <StatusGrid />
          <PromptLine command="lint" />
          <div style={{ color: theme.text.tertiary, fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 13, fontStyle: "italic" }}>
            Running FRIDA checks...
          </div>
          <ResultBox />
          <div style={{ color: theme.text.secondary, fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 13 }}>
            Awaiting your next command or request.
          </div>
          <PromptLine command="" />
        </Stack>
      </div>
    </TerminalChrome>
  );
}

function MiniTerminal({ title, tone, lines }: { title: string; tone: "success" | "warning"; lines: string[] }) {
  const theme = useHostTheme();
  return (
    <TerminalChrome title={title} trailing={<Pill tone={tone} size="sm">{tone === "success" ? "ok" : "blocked"}</Pill>}>
      <div style={{ padding: 16 }}>
        <div style={{ color: theme.diff.stripRemoved, fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontWeight: 800, letterSpacing: 5, fontSize: 18 }}>
          FRIDA
        </div>
        <pre
          style={{
            margin: "14px 0 0",
            whiteSpace: "pre-wrap",
            fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            color: theme.text.secondary,
          }}
        >
          {lines.join("\n")}
        </pre>
      </div>
    </TerminalChrome>
  );
}

function CommandStrip() {
  return (
    <Row gap={8} wrap>
      <Pill tone="info" active>status</Pill>
      <Pill tone="info">login</Pill>
      <Pill tone="info">pull</Pill>
      <Pill tone="info">lint</Pill>
      <Pill tone="info">fix</Pill>
      <Pill tone="info">push</Pill>
      <Pill tone="info">open .</Pill>
    </Row>
  );
}

export default function FridaRpaUiMockup() {
  const successLines = [
    "Push to Cognitive",
    "",
    "Target",
    "  Process      3950444",
    "  Step         0",
    "",
    "Pre-check",
    "  format       ok",
    "  safe fixes   ok",
    "  lint         clean",
    "",
    "Upload",
    "  Cognitive    complete",
    "  Remote list  verified",
  ];

  const blockedLines = [
    "Push blocked",
    "",
    "Safe fixes were applied, but lint still found issues.",
    "Nothing was uploaded to Cognitive.",
    "",
    "Errors",
    "  E004  Actions.txt:88  Block mismatch",
    "",
    "Next action",
    "  Fix the errors and run push again.",
  ];

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>FRIDA RPA CLI UI Mockup</H1>
        <Text tone="secondary">
          Visual draft of the terminal cockpit: FRIDA-branded hero, session context, command transcript, and result panels.
        </Text>
      </Stack>

      <Grid columns="1.6fr 1fr" gap={18} align="start">
        <MainTerminal />
        <Stack gap={14}>
          <Card>
            <CardHeader trailing={<Pill tone="warning" size="sm">draft</Pill>}>Design Notes</CardHeader>
            <CardBody>
              <Stack gap={10}>
                <Text size="small" tone="secondary">The top screen should feel like a dedicated FRIDA shell, not a report. The banner owns the first impression; the status grid explains where the user is.</Text>
                <Text size="small" tone="secondary">Command results should appear as transcript blocks, so lint, pull, and push feel conversational but still deterministic.</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>Command Surface</CardHeader>
            <CardBody>
              <Stack gap={12}>
                <CommandStrip />
                <Text tone="secondary" size="small">
                  Inside the shell, users type short commands only. Outside the shell, the same actions are direct commands like `frida-rpa push`.
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Stack>
      </Grid>

      <Divider />

      <Stack gap={10}>
        <H2>Result States</H2>
        <Grid columns={2} gap={16}>
          <MiniTerminal title="Push success" tone="success" lines={successLines} />
          <MiniTerminal title="Push blocked" tone="warning" lines={blockedLines} />
        </Grid>
      </Stack>
    </Stack>
  );
}
