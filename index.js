const { entrypoints, storage } = require("uxp");

entrypoints.setup({
  panels: {
    pipeEditorPanel: {
      show() {
        console.log("Pipe Editor AI 0.3 aberto");
      }
    }
  }
});

const fs = storage.localFileSystem;

const readButton = document.getElementById("readButton");
const importButton = document.getElementById("importButton");

const status = document.getElementById("status");
const importStatus = document.getElementById("importStatus");

const summary = document.getElementById("summary");
const tracks = document.getElementById("tracks");

const cutCount = document.getElementById("cutCount");
const removedTime = document.getElementById("removedTime");
const finalDuration = document.getElementById("finalDuration");

const validationStatus = document.getElementById("validationStatus");
const cutsList = document.getElementById("cutsList");

let activeSequenceDuration = null;
let importedCuts = null;

const fmt = n =>
  Number.isFinite(n)
    ? n.toFixed(2) + " s"
    : "indisponível";

const safe = value =>
  String(value ?? "sem nome");

function line(parent, cls, value) {
  const el = document.createElement("div");

  el.className = cls;
  el.textContent = value;

  parent.appendChild(el);
}

function getTime(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  if (value && typeof value === "object") {
    if (value.seconds !== undefined) {
      return getTime(value.seconds);
    }

    if (value.time !== undefined) {
      return getTime(value.time);
    }
  }

  return NaN;
}

function normalizeCut(item) {
  if (Array.isArray(item) && item.length >= 2) {
    return {
      start: getTime(item[0]),
      end: getTime(item[1])
    };
  }

  if (!item || typeof item !== "object") {
    return {
      start: NaN,
      end: NaN
    };
  }

  return {
    start: getTime(
      item.start ??
      item.inicio ??
      item.start_time ??
      item.startTime ??
      item.in
    ),

    end: getTime(
      item.end ??
      item.fim ??
      item.end_time ??
      item.endTime ??
      item.out
    )
  };
}

function extractCuts(data) {

  const candidates = [];

  function inspect(value, path = "root", depth = 0) {

    if (depth > 5 || value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {

      if (value.length > 0) {

        const first = value[0];

        const isCutArray =
          Array.isArray(first) &&
          first.length >= 2 &&
          Number.isFinite(getTime(first[0])) &&
          Number.isFinite(getTime(first[1]));

        const isCutObject =
          first &&
          typeof first === "object" &&
          !Array.isArray(first) &&
          (
            first.start !== undefined ||
            first.inicio !== undefined ||
            first.start_time !== undefined ||
            first.startTime !== undefined
          ) &&
          (
            first.end !== undefined ||
            first.fim !== undefined ||
            first.end_time !== undefined ||
            first.endTime !== undefined
          );

        if (isCutArray || isCutObject) {
          candidates.push({
            path,
            items: value
          });
        }
      }

      return;
    }

    if (typeof value === "object") {

      for (const key of Object.keys(value)) {

        inspect(
          value[key],
          path + "." + key,
          depth + 1
        );
      }
    }
  }

  inspect(data);

  if (!candidates.length) {

    const keys =
      data && typeof data === "object"
        ? Object.keys(data).join(", ")
        : "nenhuma";

    throw new Error(
      "Não foi encontrada uma lista de intervalos.\n" +
      "Campos encontrados no JSON: " + keys
    );
  }

  const preferredNames = [
    "cuts",
    "cortes",
    "intervals",
    "intervalos",
    "smart_cuts",
    "smartCuts",
    "removals",
    "cut_intervals",
    "cutIntervals",
    "remover",
    "trechos_removidos"
  ];

  function score(candidate) {

    const lastKey =
      candidate.path.split(".").pop();

    const index =
      preferredNames.indexOf(lastKey);

    if (index !== -1) {
      return 100 - index;
    }

    if (/cut|corte|remov|interval/i.test(lastKey)) {
      return 50;
    }

    return 0;
  }

  candidates.sort((a, b) => score(b) - score(a));

  const selected = candidates[0];

  // Não interpretar automaticamente palavras ou
  // segmentos de transcrição como cortes.
  if (score(selected) === 0) {

    throw new Error(
      "Encontrei intervalos de tempo, mas não consegui " +
      "confirmar que são cortes.\n" +
      "Campo encontrado: " + selected.path + "\n" +
      "Envie o JSON para ajustar o importador."
    );
  }

  const cuts = selected.items.map(normalizeCut);

  for (let i = 0; i < cuts.length; i++) {

    const cut = cuts[i];

    if (
      !Number.isFinite(cut.start) ||
      !Number.isFinite(cut.end)
    ) {
      throw new Error(
        `Corte ${i + 1}: horário inválido.`
      );
    }

    if (
      cut.start < 0 ||
      cut.end <= cut.start
    ) {
      throw new Error(
        `Corte ${i + 1}: intervalo inválido.`
      );
    }
  }

  cuts.sort((a, b) => a.start - b.start);

  console.log(
    "Pipe Editor AI: cortes encontrados em",
    selected.path
  );

  return cuts;
}

function validateCuts(cuts) {
  const problems = [];

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];

    if (i > 0 && cut.start < cuts[i - 1].end) {
      problems.push(
        `Sobreposição entre os cortes ${i} e ${i + 1}.`
      );
    }

    if (
      activeSequenceDuration !== null &&
      cut.end > activeSequenceDuration + 0.001
    ) {
      problems.push(
        `Corte ${i + 1} ultrapassa a sequência.`
      );
    }
  }

  return problems;
}

function renderCuts() {
  if (!importedCuts) {
    return;
  }

  const cuts = importedCuts;

  const totalRemoved = cuts.reduce(
    (sum, cut) => sum + (cut.end - cut.start),
    0
  );

  cutCount.textContent = String(cuts.length);
  removedTime.textContent = fmt(totalRemoved);

  if (activeSequenceDuration !== null) {
    finalDuration.textContent = fmt(
      activeSequenceDuration - totalRemoved
    );
  } else {
    finalDuration.textContent = "Leia a sequência";
  }

  const problems = validateCuts(cuts);

  validationStatus.textContent = "";

  if (activeSequenceDuration === null) {
    validationStatus.textContent =
      "Leia a sequência ativa para validar os horários.";

    validationStatus.className = "warning";
  } else if (problems.length > 0) {
    validationStatus.textContent =
      "Validação encontrou problemas:\n" +
      problems.join("\n");

    validationStatus.className = "error";
  } else {
    validationStatus.textContent =
      "Intervalos válidos dentro da duração da sequência.\n" +
      "A correspondência com o áudio original ainda precisa ser confirmada.";

    validationStatus.className = "success";
  }

  cutsList.textContent = "";

  cuts.forEach((cut, index) => {
    const box = document.createElement("div");

    box.className = "cut";

    const title = document.createElement("strong");

    title.textContent =
      `CORTE ${String(index + 1).padStart(2, "0")}`;

    const detail = document.createElement("div");

    detail.textContent =
      `${fmt(cut.start)} → ${fmt(cut.end)}`;

    const duration = document.createElement("small");

    duration.textContent =
      `Remover ${fmt(cut.end - cut.start)}`;

    box.appendChild(title);
    box.appendChild(detail);
    box.appendChild(duration);

    cutsList.appendChild(box);
  });
}

async function scanTrack(app, seq, kind, index) {
  const tr = kind === "V"
    ? await seq.getVideoTrack(index)
    : await seq.getAudioTrack(index);

  const heading =
    `${kind}${index + 1} · ${safe(tr.name)}`;

  const box = document.createElement("div");

  box.className = "track";

  line(box, "", heading);

  const items = await tr.getTrackItems(
    app.Constants.TrackItemType.CLIP,
    false
  );

  if (!items.length) {
    line(box, "clip", "Nenhum clipe.");
  }

  for (const item of items) {
    const [name, start, end, duration] =
      await Promise.all([
        item.getName(),
        item.getStartTime(),
        item.getEndTime(),
        item.getDuration()
      ]);

    line(
      box,
      "clip",
      `${safe(name)} | início ${fmt(start.seconds)} | ` +
      `fim ${fmt(end.seconds)} | ` +
      `duração ${fmt(duration.seconds)}`
    );
  }

  tracks.appendChild(box);

  return items.length;
}

readButton.addEventListener("click", async () => {
  readButton.disabled = true;

  status.textContent = "Consultando o Premiere...";

  summary.textContent = "";
  tracks.textContent = "";

  activeSequenceDuration = null;

  try {
    const app = require("premierepro");

    const project = await app.Project.getActiveProject();

    if (!project) {
      throw new Error(
        "Nenhum projeto ativo. Abra um projeto no Premiere."
      );
    }

    const seq = await project.getActiveSequence();

    if (!seq) {
      throw new Error(
        "Nenhuma sequência ativa. Abra a timeline."
      );
    }

    const [vCount, aCount, end, size] =
      await Promise.all([
        seq.getVideoTrackCount(),
        seq.getAudioTrackCount(),
        seq.getEndTime(),
        seq.getFrameSize()
      ]);

    activeSequenceDuration = end.seconds;

    line(summary, "", `Projeto: ${safe(project.name)}`);
    line(summary, "", `Sequência: ${safe(seq.name)}`);
    line(summary, "", `Duração: ${fmt(end.seconds)}`);

    line(
      summary,
      "",
      `Quadro: ${safe(size.width)} × ${safe(size.height)}`
    );

    line(
      summary,
      "",
      `Faixas: ${vCount} de vídeo, ${aCount} de áudio`
    );

    let total = 0;

    for (let i = 0; i < vCount; i++) {
      total += await scanTrack(app, seq, "V", i);
    }

    for (let i = 0; i < aCount; i++) {
      total += await scanTrack(app, seq, "A", i);
    }

    status.textContent =
      `Leitura concluída: ${total} clipe(s).\n` +
      "Nenhum corte foi aplicado.";

    renderCuts();

  } catch (err) {
    status.textContent =
      "Erro ao ler: " +
      (err?.message || String(err));

    console.error(err);

  } finally {
    readButton.disabled = false;
  }
});

importButton.addEventListener("click", async () => {
  importButton.disabled = true;

  importStatus.textContent = "Selecionando relatório...";

  try {
    const file = await fs.getFileForOpening({
      types: ["json"],
      allowMultiple: false
    });

    if (!file) {
      importStatus.textContent =
        "Importação cancelada.";

      return;
    }

    const content = await file.read();

    let data;

    try {
      data = JSON.parse(content);
    } catch {
      throw new Error(
        "O arquivo selecionado não contém JSON válido."
      );
    }

    const cuts = extractCuts(data);

    importedCuts = cuts;

    importStatus.textContent =
      `Arquivo: ${file.name}\n` +
      `${cuts.length} intervalo(s) importado(s).`;

    renderCuts();

  } catch (err) {
    importStatus.textContent =
      "Erro na importação: " +
      (err?.message || String(err));

    console.error(err);

  } finally {
    importButton.disabled = false;
  }
});

  // ==========================================
// PIPE EDITOR AI 0.4
// DIAGNÓSTICO DE 3 CORTES
// ==========================================

const testCutsButton =
  document.getElementById("testCutsButton");

const testCutsStatus =
  document.getElementById("testCutsStatus");

const testCutsDetails =
  document.getElementById("testCutsDetails");

async function getOverlappingClips(
  track,
  app,
  start,
  end
) {
  const items = await track.getTrackItems(
    app.Constants.TrackItemType.CLIP,
    false
  );

  const overlapping = [];

  for (const item of items) {
    const [itemStart, itemEnd, name] =
      await Promise.all([
        item.getStartTime(),
        item.getEndTime(),
        item.getName()
      ]);

    const clipStart = itemStart.seconds;
    const clipEnd = itemEnd.seconds;

    if (
      clipStart < end &&
      clipEnd > start
    ) {
      overlapping.push({
        name,
        start: clipStart,
        end: clipEnd
      });
    }
  }

  return overlapping;
}

testCutsButton.addEventListener(
  "click",
  async () => {

    testCutsButton.disabled = true;

    testCutsStatus.textContent =
      "Analisando três intervalos...";

    testCutsDetails.textContent = "";

    try {
      if (!importedCuts || importedCuts.length === 0) {
        throw new Error(
          "Importe primeiro o JSON do Smart Cut."
        );
      }

      if (activeSequenceDuration === null) {
        throw new Error(
          "Leia primeiro a sequência ativa."
        );
      }

      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const seq =
        await project.getActiveSequence();

      if (!seq) {
        throw new Error("Nenhuma sequência ativa.");
      }

      const [vCount, aCount, seqEnd] =
        await Promise.all([
          seq.getVideoTrackCount(),
          seq.getAudioTrackCount(),
          seq.getEndTime()
        ]);

      if (vCount < 2 || aCount < 1) {
        throw new Error(
          "A sequência precisa ter V1, V2 e A1."
        );
      }

      // Confirma se a duração não mudou
      // desde a última leitura.
      if (
        Math.abs(
          seqEnd.seconds - activeSequenceDuration
        ) > 0.05
      ) {
        throw new Error(
          "A duração da sequência mudou. " +
          "Clique novamente em Ler sequência ativa."
        );
      }

      const problems = validateCuts(importedCuts);

      if (problems.length > 0) {
        throw new Error(
          "Existem intervalos inválidos:\n" +
          problems.join("\n")
        );
      }

      const tracksToCheck = [
        {
          name: "V1",
          track: await seq.getVideoTrack(0)
        },
        {
          name: "V2",
          track: await seq.getVideoTrack(1)
        },
        {
          name: "A1",
          track: await seq.getAudioTrack(0)
        }
      ];

      const firstThree = importedCuts.slice(0, 3);

      let totalDuration = 0;
      let missingTracks = 0;

      for (
        let index = 0;
        index < firstThree.length;
        index++
      ) {
        const cut = firstThree[index];

        const duration = cut.end - cut.start;

        totalDuration += duration;

        const box = document.createElement("div");

        box.className = "cut";

        const title = document.createElement("strong");

        title.textContent =
          `TESTE ${index + 1}`;

        box.appendChild(title);

        line(
          box,
          "clip",
          `Início: ${fmt(cut.start)}`
        );

        line(
          box,
          "clip",
          `Fim: ${fmt(cut.end)}`
        );

        line(
          box,
          "clip",
          `Remoção: ${fmt(duration)}`
        );

        for (const target of tracksToCheck) {
          const clips = await getOverlappingClips(
            target.track,
            app,
            cut.start,
            cut.end
          );

          if (clips.length === 0) {
            missingTracks++;
          }

          line(
            box,
            "clip",
            `${target.name}: ${clips.length} clipe(s) ` +
            `no intervalo`
          );

          for (const clip of clips) {
            line(
              box,
              "clip",
              `  ${safe(clip.name)} | ` +
              `${fmt(clip.start)} → ${fmt(clip.end)}`
            );
          }
        }

        testCutsDetails.appendChild(box);
      }

      testCutsStatus.textContent =
        `Diagnóstico concluído.\n` +
        `Cortes analisados: ${firstThree.length}\n` +
        `Tempo previsto de remoção: ${fmt(totalDuration)}\n` +
        `Faixas sem clipes nos intervalos: ${missingTracks}\n\n` +
        `Nenhuma alteração foi realizada.`;

      testCutsStatus.className =
        missingTracks > 0 ? "warning" : "success";

    } catch (err) {
      testCutsStatus.textContent =
        "Erro no diagnóstico: " +
        (err?.message || String(err));

      testCutsStatus.className = "error";

      console.error(err);

    } finally {
      testCutsButton.disabled = false;
    }
  }
);

    // ==========================================
// PIPE EDITOR AI 0.5
// DUPLICAÇÃO SEGURA DA SEQUÊNCIA
// ==========================================

const cloneSequenceButton =
  document.getElementById("cloneSequenceButton");

const cloneSequenceStatus =
  document.getElementById("cloneSequenceStatus");

const cloneSequenceDetails =
  document.getElementById("cloneSequenceDetails");

let smartCutClone = null;

async function getSequenceSnapshot(seq, app) {
  const [end, videoCount, audioCount] =
    await Promise.all([
      seq.getEndTime(),
      seq.getVideoTrackCount(),
      seq.getAudioTrackCount()
    ]);

  const snapshot = {
    name: seq.name,
    guid: seq.guid,
    duration: end.seconds,
    videoCount,
    audioCount,
    tracks: []
  };

  for (const kind of ["V", "A"]) {
    const count =
      kind === "V" ? videoCount : audioCount;

    for (let index = 0; index < count; index++) {
      const track =
        kind === "V"
          ? await seq.getVideoTrack(index)
          : await seq.getAudioTrack(index);

      const items = await track.getTrackItems(
        app.Constants.TrackItemType.CLIP,
        false
      );

      const clips = [];

      for (const item of items) {
        const [name, start, endTime] =
          await Promise.all([
            item.getName(),
            item.getStartTime(),
            item.getEndTime()
          ]);

        clips.push({
          name: String(name),
          start: start.seconds,
          end: endTime.seconds
        });
      }

      clips.sort(
        (a, b) =>
          a.start - b.start ||
          a.end - b.end ||
          a.name.localeCompare(b.name)
      );

      snapshot.tracks.push({
        id: `${kind}${index + 1}`,
        clips
      });
    }
  }

  return snapshot;
}

function compareSequenceSnapshots(original, clone) {
  const problems = [];

  const tolerance = 0.001;

  if (
    Math.abs(original.duration - clone.duration) >
    tolerance
  ) {
    problems.push("A duração das sequências é diferente.");
  }

  if (
    original.videoCount !== clone.videoCount ||
    original.audioCount !== clone.audioCount
  ) {
    problems.push("A quantidade de faixas é diferente.");
  }

  if (original.tracks.length !== clone.tracks.length) {
    problems.push("A estrutura das faixas é diferente.");
  }

  for (const originalTrack of original.tracks) {
    const clonedTrack = clone.tracks.find(
      track => track.id === originalTrack.id
    );

    if (!clonedTrack) {
      problems.push(
        `Faixa ${originalTrack.id} não encontrada na cópia.`
      );

      continue;
    }

    if (
      originalTrack.clips.length !==
      clonedTrack.clips.length
    ) {
      problems.push(
        `Quantidade de clipes diferente em ${originalTrack.id}.`
      );

      continue;
    }

    for (
      let index = 0;
      index < originalTrack.clips.length;
      index++
    ) {
      const a = originalTrack.clips[index];
      const b = clonedTrack.clips[index];

      if (
        a.name !== b.name ||
        Math.abs(a.start - b.start) > tolerance ||
        Math.abs(a.end - b.end) > tolerance
      ) {
        problems.push(
          `Diferença no clipe ${index + 1} de ${originalTrack.id}.`
        );
      }
    }
  }

  return problems;
}

cloneSequenceButton.addEventListener(
  "click",
  async () => {
    cloneSequenceButton.disabled = true;

    cloneSequenceStatus.className = "";
    cloneSequenceStatus.textContent =
      "Preparando duplicação...";

    cloneSequenceDetails.textContent = "";

    try {
      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const original =
        await project.getActiveSequence();

      if (!original) {
        throw new Error("Nenhuma sequência ativa.");
      }

      // Não duplicar novamente a mesma sequência
      // por engano durante um teste.
      if (
        smartCutClone &&
        smartCutClone.sourceGuid === original.guid
      ) {
        throw new Error(
          "Esta sequência já foi duplicada nesta sessão. " +
          "Confira a cópia criada antes de repetir o teste."
        );
      }

      const originalSnapshot =
        await getSequenceSnapshot(original, app);

      const sequencesBefore =
        await project.getSequences();

      const previousGuids = new Set(
        sequencesBefore.map(seq => String(seq.guid))
      );

      cloneSequenceStatus.textContent =
        "Duplicando sequência no projeto...";

      // As ações devem ser criadas e executadas
      // dentro do acesso bloqueado ao projeto.
      //
      // A chamada é síncrona conforme a API UXP.
      let transactionResult;

      project.lockedAccess(() => {
        const cloneAction =
          original.createCloneAction();

        transactionResult =
          project.executeTransaction(
            compoundAction => {
              compoundAction.addAction(cloneAction);
            },
            "Pipe Editor AI - Duplicar sequência"
          );
      });

      if (transactionResult !== true) {
        throw new Error(
          "O Premiere não confirmou a transação de duplicação."
        );
      }

      const sequencesAfter =
        await project.getSequences();

      const createdSequences =
        sequencesAfter.filter(
          seq => !previousGuids.has(String(seq.guid))
        );

      if (createdSequences.length !== 1) {
        throw new Error(
          "A transação foi executada, mas não foi possível " +
          "identificar uma única sequência nova. " +
          "Verifique o painel Projeto antes de tentar novamente."
        );
      }

      const clonedSequence = createdSequences[0];

      const cloneSnapshot =
        await getSequenceSnapshot(clonedSequence, app);

      const differences =
        compareSequenceSnapshots(
          originalSnapshot,
          cloneSnapshot
        );

      smartCutClone = {
        sourceGuid: original.guid,
        cloneGuid: clonedSequence.guid
      };

      line(
        cloneSequenceDetails,
        "clip",
        `Original: ${originalSnapshot.name}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Cópia: ${cloneSnapshot.name}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Duração original: ${fmt(originalSnapshot.duration)}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Duração da cópia: ${fmt(cloneSnapshot.duration)}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Faixas de vídeo: ${cloneSnapshot.videoCount}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Faixas de áudio: ${cloneSnapshot.audioCount}`
      );

      for (const track of cloneSnapshot.tracks) {
        line(
          cloneSequenceDetails,
          "clip",
          `${track.id}: ${track.clips.length} clipe(s)`
        );
      }

      if (differences.length > 0) {
        cloneSequenceStatus.className = "warning";

        cloneSequenceStatus.textContent =
          "Cópia criada, mas foram encontradas diferenças:\n" +
          differences.slice(0, 10).join("\n") +
          "\nNenhum corte foi aplicado.";
      } else {
        cloneSequenceStatus.className = "success";

        cloneSequenceStatus.textContent =
          "Sequência duplicada com sucesso.\n" +
          "Duração, quantidade de faixas, nomes e " +
          "posições dos clipes conferidos.\n" +
          "Nenhum corte foi aplicado.";
      }

    } catch (err) {
      cloneSequenceStatus.className = "error";

      cloneSequenceStatus.textContent =
        "Erro na duplicação: " +
        (err?.message || String(err));

      console.error(err);

    } finally {
      cloneSequenceButton.disabled = false;
    }
  }
);

// PIPE EDITOR AI 0.6 - DIAGNÓSTICO DA API
const checkEditingApiButton =
  document.getElementById("checkEditingApiButton");

const editingApiStatus =
  document.getElementById("editingApiStatus");

checkEditingApiButton.addEventListener(
  "click",
  async () => {
    checkEditingApiButton.disabled = true;

    editingApiStatus.textContent =
      "Verificando recursos de edição...";

    try {
      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const sequence =
        await project.getActiveSequence();

      if (!sequence) {
        throw new Error("Nenhuma sequência ativa.");
      }

      const editor =
        app.SequenceEditor.getEditor(sequence);

      const videoTrack =
        await sequence.getVideoTrack(0);

      const audioTrack =
        await sequence.getAudioTrack(0);

      const videoItems =
        await videoTrack.getTrackItems(
          app.Constants.TrackItemType.CLIP,
          false
        );

      const audioItems =
        await audioTrack.getTrackItems(
          app.Constants.TrackItemType.CLIP,
          false
        );

      const videoClip = videoItems[0];
      const audioClip = audioItems[0];

      function available(object, method) {
        return Boolean(
          object &&
          typeof object[method] === "function"
        );
      }

      const results = [
        ["SequenceEditor", Boolean(editor)],

        [
          "Remover itens",
          available(editor, "createRemoveItemsAction")
        ],

        [
          "Inserir mídia",
          available(editor, "createInsertProjectItemAction")
        ],

        [
          "Sobrescrever mídia",
          available(editor, "createOverwriteItemAction")
        ],

        [
          "Duplicar item",
          available(editor, "createCloneTrackItemAction")
        ],

        [
          "Ajustar início do vídeo",
          available(videoClip, "createSetStartAction")
        ],

        [
          "Ajustar fim do vídeo",
          available(videoClip, "createSetEndAction")
        ],

        [
          "Ajustar início do áudio",
          available(audioClip, "createSetStartAction")
        ],

        [
          "Ajustar fim do áudio",
          available(audioClip, "createSetEndAction")
        ],

        [
          "Mover vídeo",
          available(videoClip, "createMoveAction")
        ],

        [
          "Duplicar sequência",
          available(sequence, "createCloneAction")
        ]
      ];

      editingApiStatus.textContent =
        results.map(([name, supported]) =>
          `${supported ? "OK" : "INDISPONÍVEL"} · ${name}`
        ).join("\n");

      console.log(
        "Pipe Editor AI - Recursos de edição:",
        results
      );

    } catch (err) {
      editingApiStatus.textContent =
        "Erro: " + (err?.message || String(err));

      console.error(err);

    } finally {
      checkEditingApiButton.disabled = false;
    }
  }
);


// ==========================================
// PIPE EDITOR AI 0.7
// PRÉVIA TEMPORAL (SOMENTE LEITURA)
// ==========================================

// Simula a remoção de intervalos no tempo da sequência.
// Não altera, reinterpreta nem grava mídias no Premiere.
// A preservação de efeitos e de in/out de fonte será
// verificada quando implementarmos a edição real.
function buildSmartCutTimePlan(sequenceSnapshot, cuts) {
  const ordered = cuts.slice().sort((a, b) => a.start - b.start);
  const epsilon = 0.00000001;

  for (let index = 0; index < ordered.length; index++) {
    const cut = ordered[index];

    if (
      !Number.isFinite(cut.start) ||
      !Number.isFinite(cut.end) ||
      cut.start < 0 ||
      cut.end <= cut.start ||
      cut.end > sequenceSnapshot.duration + 0.001
    ) {
      throw new Error("Intervalo inválido no corte " + (index + 1));
    }

    if (index > 0 && cut.start < ordered[index - 1].end - epsilon) {
      throw new Error("Os intervalos de corte estão sobrepostos.");
    }
  }

  const removed = ordered.reduce(
    (total, cut) => total + cut.end - cut.start,
    0
  );

  function removedBefore(time) {
    let sum = 0;

    for (const cut of ordered) {
      if (time <= cut.start) break;
      sum += Math.max(
        0,
        Math.min(time, cut.end) - cut.start
      );
    }

    return sum;
  }

  const tracks = sequenceSnapshot.tracks.map(track => {
    const segments = [];

    for (const clip of track.clips) {
      let cursor = clip.start;

      function appendVisibleSegment(start, end) {
        if (end <= start + epsilon) return;

        const newStart = start - removedBefore(start);
        const newEnd = end - removedBefore(end);

        segments.push({
          name: clip.name,
          originalStart: start,
          originalEnd: end,
          newStart,
          newEnd
        });
      }

      for (const cut of ordered) {
        if (cut.end <= cursor + epsilon) continue;
        if (cut.start >= clip.end - epsilon) break;

        appendVisibleSegment(
          cursor,
          Math.min(cut.start, clip.end)
        );

        cursor = Math.max(cursor, cut.end);
        if (cursor >= clip.end - epsilon) break;
      }

      appendVisibleSegment(cursor, clip.end);
    }

    return {
      id: track.id,
      inputClips: track.clips.length,
      segments
    };
  });

  return {
    removed,
    projectedDuration: Math.max(
      0,
      sequenceSnapshot.duration - removed
    ),
    tracks
  };
}

const previewCutPlanButton =
  document.getElementById("previewCutPlanButton");

const previewCutPlanStatus =
  document.getElementById("previewCutPlanStatus");

const previewCutPlanDetails =
  document.getElementById("previewCutPlanDetails");

previewCutPlanButton.addEventListener("click", async () => {
  previewCutPlanButton.disabled = true;
  previewCutPlanStatus.textContent = "Calculando plano de corte...";
  previewCutPlanDetails.textContent = "";

  try {
    if (!importedCuts || !importedCuts.length) {
      throw new Error("Importe o JSON antes de calcular o plano.");
    }

    if (activeSequenceDuration === null) {
      throw new Error("Clique em Ler sequência ativa primeiro.");
    }

    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto aberto.");

    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("Nenhuma sequência ativa.");

    const currentEnd = await seq.getEndTime();
    if (
      Math.abs(currentEnd.seconds - activeSequenceDuration) > 0.05
    ) {
      throw new Error(
        "A duração da sequência mudou desde a leitura. " +
        "Clique novamente em Ler sequência ativa."
      );
    }

    const problems = validateCuts(importedCuts);
    if (problems.length) {
      throw new Error(
        "Corrija a validação dos cortes: " +
        problems.join("; ")
      );
    }

    const snapshot = await getSequenceSnapshot(seq, app);

    const allCutsPlan = buildSmartCutTimePlan(
      snapshot,
      importedCuts
    );

    const first = importedCuts[0];
    const firstCutPlan = buildSmartCutTimePlan(
      snapshot,
      [first]
    );

    previewCutPlanStatus.className = "success";
    previewCutPlanStatus.textContent =
      "Plano temporal calculado. Nenhum clipe foi alterado.\n" +
      "Cortes planejados: " + importedCuts.length + "\n" +
      "Remoção total: " + fmt(allCutsPlan.removed) + "\n" +
      "Duração projetada: " + fmt(allCutsPlan.projectedDuration);

    const header = document.createElement("div");
    header.className = "cut";
    line(
      header,
      "clip",
      "CORTE 1: " + fmt(first.start) +
      " → " + fmt(first.end) +
      " | remoção " + fmt(first.end - first.start)
    );
    previewCutPlanDetails.appendChild(header);

    for (const track of firstCutPlan.tracks) {
      const box = document.createElement("div");
      box.className = "cut";

      const title = document.createElement("strong");
      title.textContent = track.id;
      box.appendChild(title);

      if (!track.segments.length) {
        line(box, "clip", "Sem clipes remanescentes nesta faixa.");
      }

      for (const segment of track.segments) {
        line(
          box,
          "clip",
          segment.name + "\n" +
          "Origem: " + fmt(segment.originalStart) +
          " → " + fmt(segment.originalEnd) + "\n" +
          "Após corte: " + fmt(segment.newStart) +
          " → " + fmt(segment.newEnd)
        );
      }

      previewCutPlanDetails.appendChild(box);
    }

    const note = document.createElement("div");
    note.className = "warning";
    note.textContent =
      "Prévia matemática: antes de executar cortes reais, " +
      "precisamos alinhar limites aos frames, preservar " +
      "in/out de fonte e validar efeitos, velocidade e áudio. " +
      "Nenhuma edição foi feita.";
    previewCutPlanDetails.appendChild(note);

  } catch (err) {
    previewCutPlanStatus.className = "error";
    previewCutPlanStatus.textContent =
      "Não foi possível calcular: " +
      (err?.message || String(err));
    console.error(err);
  } finally {
    previewCutPlanButton.disabled = false;
  }
});


// ==========================================
// PIPE EDITOR AI 0.8
// EXPORTAÇÃO DA SEQUÊNCIA PARA FCP7 XML
// Nenhuma alteração nos itens da timeline.
// ==========================================

const exportSequenceXmlButton =
  document.getElementById("exportSequenceXmlButton");

const exportXmlStatus =
  document.getElementById("exportXmlStatus");

exportSequenceXmlButton.addEventListener("click", async () => {
  exportSequenceXmlButton.disabled = true;
  exportXmlStatus.className = "";
  exportXmlStatus.textContent =
    "Preparando exportação da sequência...";

  try {
    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto ativo.");

    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Nenhuma sequência ativa.");

    if (
      !app.ProjectConverter ||
      typeof app.ProjectConverter.exportAsFinalCutProXML !== "function"
    ) {
      throw new Error(
        "Esta instalação não oferece ProjectConverter." +
        "exportAsFinalCutProXML (requer Premiere 26.2+). " +
        "Use Arquivo > Exportar > Final Cut Pro XML."
      );
    }

    // O nome da sequência não é usado no caminho nativo;
    // o usuário seleciona explicitamente onde salvar.
    const file = await fs.getFileForSaving(
      "PipeEditorAI_Sequencia_Original.xml",
      { types: ["xml"] }
    );

    if (!file) {
      exportXmlStatus.textContent = "Exportação cancelada.";
      return;
    }

    const nativePath = fs.getNativePath(file);
    if (!nativePath || typeof nativePath !== "string") {
      throw new Error("Não foi possível obter o caminho do XML.");
    }

    exportXmlStatus.textContent =
      "Exportando XML para o arquivo selecionado...";

    const exported =
      await app.ProjectConverter.exportAsFinalCutProXML(
        sequence,
        nativePath,
        true // suppressUI; o destino já foi escolhido.
      );

    if (exported !== true) {
      throw new Error(
        "O Premiere não confirmou a exportação. " +
        "Verifique se o arquivo foi criado corretamente."
      );
    }

    exportXmlStatus.className = "success";
    exportXmlStatus.textContent =
      "XML exportado com sucesso.\n" +
      "Sequência: " + safe(sequence.name) + "\n" +
      "Arquivo: " + nativePath + "\n" +
      "O projeto e a timeline não foram modificados.\n\n" +
      "Envie este arquivo XML nesta conversa para " +
      "prepararmos os cortes das duas câmeras e do áudio.";

  } catch (err) {
    exportXmlStatus.className = "error";
    exportXmlStatus.textContent =
      "Erro ao exportar XML: " +
      (err?.message || String(err));
    console.error(err);
  } finally {
    exportSequenceXmlButton.disabled = false;
  }
});

// O Razor de novas versões da API não deve ser confundido
// com createSetStartAction/createSetEndAction: esses métodos
// não garantem a divisão em dois trackItems.
const checkNativeRazorButton =
  document.getElementById("checkNativeRazorButton");

const nativeRazorStatus =
  document.getElementById("nativeRazorStatus");

checkNativeRazorButton.addEventListener("click", async () => {
  checkNativeRazorButton.disabled = true;
  nativeRazorStatus.textContent = "Verificando a API Razor...";

  try {
    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto ativo.");

    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Nenhuma sequência ativa.");

    const editor = app.SequenceEditor.getEditor(sequence);
    const trackRazor = Boolean(
      editor &&
      typeof editor.createRazorTrackAction === "function"
    );
    const allRazor = Boolean(
      editor &&
      typeof editor.createRazorAllTracksAction === "function"
    );

    // A propriedade Application.version pode ser assíncrona.
    let hostVersion = "não informada";
    try {
      const v = await app.version;
      if (v !== undefined && v !== null) {
        hostVersion = String(v);
      }
    } catch {
      // O resultado de compatibilidade vem diretamente do editor.
    }

    nativeRazorStatus.className =
      trackRazor ? "success" : "warning";

    nativeRazorStatus.textContent =
      "Premiere: " + hostVersion + "\n" +
      "createRazorTrackAction: " +
      (trackRazor ? "DISPONÍVEL" : "INDISPONÍVEL") + "\n" +
      "createRazorAllTracksAction: " +
      (allRazor ? "DISPONÍVEL" : "INDISPONÍVEL") + "\n\n" +
      (trackRazor
        ? "A instalação possui Razor nativo. " +
          "A execução segura em cópia será implementada " +
          "após validar o comportamento da sua versão."
        : "Sem Razor nativo: usaremos o XML da sequência " +
          "para criar uma nova timeline editada, sem modificar " +
          "a original.");

  } catch (err) {
    nativeRazorStatus.className = "error";
    nativeRazorStatus.textContent =
      "Erro no diagnóstico: " +
      (err?.message || String(err));
    console.error(err);
  } finally {
    checkNativeRazorButton.disabled = false;
  }
});


// ==========================================
// PIPE EDITOR AI 0.9 — VALIDAÇÃO NO PREMIERE
// SOMENTE LEITURA: NUNCA MODIFICA A TIMELINE
// ==========================================
const registerOriginalButton =
  document.getElementById("registerOriginalButton");
const checkImportedSequenceButton =
  document.getElementById("checkImportedSequenceButton");
const sequenceAuditStatus =
  document.getElementById("sequenceAuditStatus");
const sequenceAuditDetails =
  document.getElementById("sequenceAuditDetails");
const sequenceAuditMode =
  document.getElementById("sequenceAuditMode");

let smartCutOriginalAudit = null;

function auditFrame(seconds, fps) {
  return Math.round(Number(seconds) * fps);
}

async function auditSnapshot(app, seq) {
  const settings = await seq.getSettings();
  if (!settings || typeof settings.getVideoFrameRate !== "function") {
    throw new Error("A API não fornece a taxa de quadros da sequência.");
  }

  const frameRate = await settings.getVideoFrameRate();
  const fps = Number(frameRate?.value);

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Taxa de quadros inválida na sequência.");
  }

  const [duration, videoCount, audioCount] = await Promise.all([
    seq.getEndTime(),
    seq.getVideoTrackCount(),
    seq.getAudioTrackCount()
  ]);

  const output = {
    name: String(seq.name),
    guid: String(seq.guid),
    fps,
    duration: duration.seconds,
    tracks: []
  };

  for (const kind of ["V", "A"]) {
    const count = kind === "V" ? videoCount : audioCount;
    for (let index = 0; index < count; index++) {
      const track = kind === "V"
        ? await seq.getVideoTrack(index)
        : await seq.getAudioTrack(index);
      const items = await track.getTrackItems(
        app.Constants.TrackItemType.CLIP,
        false
      );
      const clips = [];
      for (const item of items) {
        const [name, start, end, mediaIn, mediaOut] = await Promise.all([
          item.getName(),
          item.getStartTime(),
          item.getEndTime(),
          item.getInPoint(),
          item.getOutPoint()
        ]);

        clips.push({
          name: String(name),
          start: start.seconds,
          end: end.seconds,
          sourceIn: mediaIn.seconds,
          sourceOut: mediaOut.seconds
        });
      }
      clips.sort((a, b) => a.start - b.start || a.end - b.end);
      output.tracks.push({ id: kind + (index + 1), clips });
    }
  }

  return output;
}

function buildAuditExpectations(source, cuts) {
  const fps = source.fps;
  const endFrame = auditFrame(source.duration, fps);
  const ranges = cuts.map((c, i) => {
    const a = auditFrame(c.start, fps);
    const b = auditFrame(c.end, fps);
    if (a < 0 || b <= a || b > endFrame) {
      throw new Error("Corte " + (i + 1) + " inválido após arredondamento.");
    }
    return { a, b };
  }).sort((a, b) => a.a - b.a);

  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].a < ranges[i - 1].b) {
      throw new Error("Cortes sobrepostos após ajuste aos frames.");
    }
  }

  const totalRemoved = ranges.reduce((sum, cut) => sum + cut.b - cut.a, 0);
  function removedBefore(frame) {
    let result = 0;
    for (const cut of ranges) {
      if (frame <= cut.a) break;
      result += Math.max(0, Math.min(frame, cut.b) - cut.a);
    }
    return result;
  }

  const tracks = source.tracks.map(track => {
    const clips = [];
    for (const original of track.clips) {
      const start = auditFrame(original.start, fps);
      const end = auditFrame(original.end, fps);
      const sourceIn = auditFrame(original.sourceIn, fps);
      const sourceOut = auditFrame(original.sourceOut, fps);

      if (
        Math.abs((sourceOut - sourceIn) - (end - start)) > 2
      ) {
        throw new Error(
          "Velocidade ou duração de mídia não compatível em " +
          track.id + " (" + original.name + ")."
        );
      }

      // Particiona o clipe original preservando cada intervalo útil.
      let cursor = start;

      function keep(a, b) {
        if (b <= a) return;
        const newStart = a - removedBefore(a);
        const newEnd = b - removedBefore(b);
        clips.push({
          name: original.name,
          start: newStart,
          end: newEnd,
          sourceIn: sourceIn + a - start,
          sourceOut: sourceIn + b - start
        });
      }

      for (const cut of ranges) {
        if (cut.b <= cursor) continue;
        if (cut.a >= end) break;
        keep(cursor, Math.min(cut.a, end));
        cursor = Math.max(cursor, cut.b);
        if (cursor >= end) break;
      }
      keep(cursor, end);
    }

    clips.sort((a, b) => a.start - b.start || a.end - b.end);
    return { id: track.id, clips };
  });

  return {
    fps,
    totalRemoved,
    duration: endFrame - totalRemoved,
    cuts: ranges.length,
    tracks
  };
}

function compareAudit(expected, actual) {
  const issues = [];
  const summaries = [];
  const fpsTolerance = 0.01;

  if (Math.abs(expected.fps - actual.fps) > fpsTolerance) {
    issues.push(
      "FPS divergente: original " + expected.fps +
      ", editada " + actual.fps
    );
    return { issues, summaries };
  }

  function frames(seconds) {
    return auditFrame(seconds, expected.fps);
  }

  const actualDuration = frames(actual.duration);
  if (Math.abs(actualDuration - expected.duration) > 1) {
    issues.push(
      "Duração: esperado " + expected.duration +
      " frames, obtido " + actualDuration + " frames"
    );
  }

  for (const track of expected.tracks) {
    const found = actual.tracks.find(t => t.id === track.id);
    const actualClips = found ? found.clips : [];

    summaries.push(
      track.id + ": " + actualClips.length +
      " / " + track.clips.length + " segmentos"
    );

    if (actualClips.length !== track.clips.length) {
      issues.push(
        track.id + ": esperado " + track.clips.length +
        " segmentos, encontrado " + actualClips.length
      );
      continue;
    }

    for (let i = 0; i < track.clips.length; i++) {
      const a = track.clips[i];
      const b = actualClips[i];
      const label = track.id + " segmento " + (i + 1);
      if (
        a.name.trim().toLowerCase() !==
        b.name.trim().toLowerCase()
      ) {
        issues.push(label + ": fonte diferente.");
      }

      for (const field of ["start", "end", "sourceIn", "sourceOut"]) {
        const got = frames(b[field]);
        const expectedFrame = a[field];
        // A importação de XML pode arredondar a mídia ao frame.
        // 1 frame para a timeline; 2 para tempos de mídia.
        const tolerance =
          field === "sourceIn" || field === "sourceOut" ? 2 : 1;
        if (Math.abs(got - expectedFrame) > tolerance) {
          issues.push(
            label + ": " + field + " esperado " +
            expectedFrame + ", obtido " + got + " frames."
          );
        }
      }
    }
  }

  const additionalTracks = actual.tracks.filter(
    t => !expected.tracks.some(e => e.id === t.id) &&
      t.clips.length > 0
  );
  for (const track of additionalTracks) {
    issues.push(
      "Faixa adicional com clipes: " + track.id +
      " (" + track.clips.length + ")."
    );
  }

  return { issues, summaries };
}

registerOriginalButton.addEventListener("click", async () => {
  registerOriginalButton.disabled = true;
  sequenceAuditStatus.textContent = "Lendo sequência original...";
  sequenceAuditDetails.textContent = "";

  try {
    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto ativo.");
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("Nenhuma sequência ativa.");

    const source = await auditSnapshot(app, seq);

    if (importedCuts && importedCuts.length) {
      const expected = buildAuditExpectations(source, importedCuts);
      if (expected.duration >= auditFrame(source.duration, source.fps)) {
        throw new Error("A sequência aberta parece já estar editada.");
      }
    }

    smartCutOriginalAudit = source;
    sequenceAuditStatus.className = "success";
    sequenceAuditStatus.textContent =
      "Original registrada: " + source.name + "\n" +
      "Duração: " + fmt(source.duration) + "\n" +
      "FPS: " + source.fps + "\n" +
      "Agora abra a sequência editada e clique em Validar.";
  } catch (err) {
    sequenceAuditStatus.className = "error";
    sequenceAuditStatus.textContent =
      "Erro ao registrar original: " + (err?.message || String(err));
    console.error(err);
  } finally {
    registerOriginalButton.disabled = false;
  }
});

checkImportedSequenceButton.addEventListener("click", async () => {
  checkImportedSequenceButton.disabled = true;
  sequenceAuditStatus.textContent = "Conferindo todos os segmentos...";
  sequenceAuditDetails.textContent = "";

  try {
    if (!smartCutOriginalAudit) {
      throw new Error("Registre primeiro a sequência original.");
    }
    if (!importedCuts || !importedCuts.length) {
      throw new Error("Importe primeiro o JSON dos cortes.");
    }

    const mode = sequenceAuditMode.value;
    const selected = mode === "first"
      ? importedCuts.slice(0, 1)
      : importedCuts;

    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto ativo.");
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Nenhuma sequência ativa.");
    if (String(sequence.guid) === smartCutOriginalAudit.guid) {
      throw new Error(
        "Você ainda está na sequência original. " +
        "Abra a sequência importada antes da validação."
      );
    }

    const actual = await auditSnapshot(app, sequence);
    const expected = buildAuditExpectations(
      smartCutOriginalAudit,
      selected
    );
    const result = compareAudit(expected, actual);

    sequenceAuditStatus.className =
      result.issues.length ? "warning" : "success";
    sequenceAuditStatus.textContent =
      "Sequência: " + actual.name + "\n" +
      "Intervalos: " + selected.length + "\n" +
      "Remoção planejada: " +
      fmt(expected.totalRemoved / expected.fps) + "\n" +
      "Duração prevista: " +
      fmt(expected.duration / expected.fps) + "\n" +
      "Duração encontrada: " +
      fmt(actual.duration) + "\n\n" +
      (result.issues.length
        ? "Diferenças encontradas: " + result.issues.length +
          "\nConfira os detalhes abaixo."
        : "Validação temporal aprovada. " +
          "Fontes, in/out e posições conferidos.");

    for (const lineText of result.summaries) {
      line(sequenceAuditDetails, "clip", lineText);
    }
    for (const issue of result.issues.slice(0, 25)) {
      line(sequenceAuditDetails, "clip", "ATENÇÃO: " + issue);
    }
    if (result.issues.length > 25) {
      line(
        sequenceAuditDetails,
        "clip",
        "... e mais " + (result.issues.length - 25) +
        " diferença(s)."
      );
    }
    line(
      sequenceAuditDetails,
      "clip",
      "A validação é estrutural. Escute as emendas para " +
      "confirmar que nenhuma palavra foi cortada."
    );

  } catch (err) {
    sequenceAuditStatus.className = "error";
    sequenceAuditStatus.textContent =
      "Erro na validação: " + (err?.message || String(err));
    console.error(err);
  } finally {
    checkImportedSequenceButton.disabled = false;
  }
});


// ==========================================
// PIPE EDITOR AI 1.0 — REVISÃO DE EMENDAS
// Somente navegação: nenhuma alteração nos clipes.
// ==========================================
const reviewStartButton = document.getElementById("reviewStartButton");
const reviewPreviousButton = document.getElementById("reviewPreviousButton");
const reviewNextButton = document.getElementById("reviewNextButton");
const reviewJumpButton = document.getElementById("reviewJumpButton");
const reviewBeforeButton = document.getElementById("reviewBeforeButton");
const reviewApproveButton = document.getElementById("reviewApproveButton");
const reviewFlagButton = document.getElementById("reviewFlagButton");
const reviewExportButton = document.getElementById("reviewExportButton");
const reviewStatus = document.getElementById("reviewStatus");
const reviewCounter = document.getElementById("reviewCounter");
const reviewTime = document.getElementById("reviewTime");
const reviewProgress = document.getElementById("reviewProgress");
const reviewNote = document.getElementById("reviewNote");

let reviewSession = null;
let reviewIndex = 0;

function makeReviewSeams(cuts, fps) {
  const sorted = cuts.slice().sort((a, b) => a.start - b.start);
  let removedBefore = 0;
  let previousEnd = 0;

  return sorted.map((cut, index) => {
    const startFrame = Math.round(cut.start * fps);
    const endFrame = Math.round(cut.end * fps);

    if (startFrame < previousEnd || endFrame <= startFrame) {
      throw new Error("Corte inválido ou sobreposto: " + (index + 1));
    }

    const seamFrame = startFrame - removedBefore;
    const item = {
      index: index + 1,
      sourceStart: cut.start,
      sourceEnd: cut.end,
      startFrame,
      endFrame,
      seamFrame,
      seamSeconds: seamFrame / fps,
      removedFrames: endFrame - startFrame,
      verdict: "pendente",
      note: ""
    };

    removedBefore += item.removedFrames;
    previousEnd = endFrame;
    return item;
  });
}

function currentReviewCut() {
  return reviewSession && reviewSession.cuts[reviewIndex];
}

function saveCurrentReviewNote() {
  const cut = currentReviewCut();
  if (cut) cut.note = String(reviewNote.value || "").trim();
}

function paintReview() {
  if (!reviewSession) {
    reviewStatus.textContent =
      "Registre a sequência original e importe os cortes antes de iniciar.";
    return;
  }

  const cut = currentReviewCut();
  const total = reviewSession.cuts.length;
  const counts = { aprovado: 0, revisar: 0, pendente: 0 };

  for (const item of reviewSession.cuts) {
    counts[item.verdict] = (counts[item.verdict] || 0) + 1;
  }

  reviewCounter.textContent = "Emenda " + cut.index + " de " + total;
  reviewTime.textContent =
    "Posição na sequência editada: " +
    cut.seamSeconds.toFixed(3) + " s\n" +
    "Trecho removido da origem: " +
    cut.sourceStart.toFixed(3) + " → " +
    cut.sourceEnd.toFixed(3) + " s\n" +
    "Remoção quantizada: " +
    (cut.removedFrames / reviewSession.fps).toFixed(3) + " s\n" +
    "Avaliação: " + cut.verdict.toUpperCase();
  reviewProgress.textContent =
    "Aprovados: " + counts.aprovado +
    " · Revisar: " + counts.revisar +
    " · Pendentes: " + counts.pendente;
  reviewNote.value = cut.note;

  reviewPreviousButton.disabled = reviewIndex === 0;
  reviewNextButton.disabled = reviewIndex === total - 1;
  reviewStatus.className = "success";
  reviewStatus.textContent =
    "Revisão ativa: " + reviewSession.sequenceName + "\n" +
    "Use '1 s antes' para posicionar o cursor, " +
    "e reproduza pelo Premiere. " +
    "Este painel não inicia playback automaticamente.";
}

async function getAuditedReviewSequence() {
  if (!reviewSession) {
    throw new Error("Clique primeiro em Iniciar revisão.");
  }

  const app = require("premierepro");
  const project = await app.Project.getActiveProject();
  if (!project) throw new Error("Nenhum projeto ativo.");

  const sequence = await project.getActiveSequence();
  if (!sequence || String(sequence.guid) !== reviewSession.sequenceGuid) {
    throw new Error(
      "A sequência ativa mudou. Reabra a sequência editada " +
      "ou inicie a revisão novamente."
    );
  }

  return { app, sequence };
}

async function jumpReview(secondsBefore) {
  const { app, sequence } = await getAuditedReviewSequence();
  saveCurrentReviewNote();

  const point = Math.max(
    0,
    currentReviewCut().seamSeconds - secondsBefore
  );
  const tick = app.TickTime.createWithSeconds(point);
  const jumped = await sequence.setPlayerPosition(tick);

  if (jumped !== true) {
    throw new Error("O Premiere não confirmou o posicionamento do cursor.");
  }

  paintReview();
  reviewStatus.textContent =
    "Cursor posicionado em " + point.toFixed(3) +
    " s na sequência editada.\n" +
    "Reproduza o trecho no Premiere e marque a avaliação.";
}

async function handleReviewNavigation(action) {
  try {
    await action();
  } catch (err) {
    reviewStatus.className = "error";
    reviewStatus.textContent =
      "Erro na revisão: " + (err?.message || String(err));
    console.error(err);
  }
}

reviewStartButton.addEventListener("click", async () => {
  reviewStartButton.disabled = true;
  reviewStatus.className = "";
  reviewStatus.textContent = "Validando a sequência editada...";
  try {
    if (!smartCutOriginalAudit) {
      throw new Error(
        "Na seção 10, registre primeiro a sequência ORIGINAL."
      );
    }
    if (!importedCuts || importedCuts.length < 1) {
      throw new Error("Importe o JSON Smart Cut primeiro.");
    }

    const app = require("premierepro");
    const project = await app.Project.getActiveProject();
    if (!project) throw new Error("Nenhum projeto ativo.");

    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Nenhuma sequência ativa.");

    if (String(sequence.guid) === smartCutOriginalAudit.guid) {
      throw new Error(
        "Abra a sequência já editada, não a original."
      );
    }

    const actual = await auditSnapshot(app, sequence);
    const expected = buildAuditExpectations(
      smartCutOriginalAudit,
      importedCuts
    );
    const comparison = compareAudit(expected, actual);

    if (comparison.issues.length) {
      throw new Error(
        "A sequência editada não passou na auditoria: " +
        comparison.issues[0] +
        " (total de diferenças: " +
        comparison.issues.length + ")."
      );
    }

    const rate = smartCutOriginalAudit.fps;
    reviewSession = {
      sourceName: smartCutOriginalAudit.name,
      sequenceName: actual.name,
      sequenceGuid: String(actual.guid),
      fps: rate,
      cuts: makeReviewSeams(importedCuts, rate),
      startedAt: new Date().toISOString()
    };
    reviewIndex = 0;
    paintReview();
  } catch (err) {
    reviewSession = null;
    reviewStatus.className = "error";
    reviewStatus.textContent =
      "Não foi possível iniciar: " +
      (err?.message || String(err));
    console.error(err);
  } finally {
    reviewStartButton.disabled = false;
  }
});

reviewPreviousButton.addEventListener("click", () =>
  handleReviewNavigation(async () => {
    await getAuditedReviewSequence();
    saveCurrentReviewNote();
    reviewIndex = Math.max(0, reviewIndex - 1);
    paintReview();
    await jumpReview(1);
  })
);
reviewNextButton.addEventListener("click", () =>
  handleReviewNavigation(async () => {
    await getAuditedReviewSequence();
    saveCurrentReviewNote();
    reviewIndex = Math.min(reviewSession.cuts.length - 1, reviewIndex + 1);
    paintReview();
    await jumpReview(1);
  })
);
reviewJumpButton.addEventListener("click", () =>
  handleReviewNavigation(() => jumpReview(0))
);
reviewBeforeButton.addEventListener("click", () =>
  handleReviewNavigation(() => jumpReview(1))
);

function markReview(verdict) {
  return handleReviewNavigation(async () => {
    await getAuditedReviewSequence();
    saveCurrentReviewNote();
    currentReviewCut().verdict = verdict;
    const wasLast = reviewIndex === reviewSession.cuts.length - 1;
    if (!wasLast) reviewIndex++;
    paintReview();
    if (!wasLast) await jumpReview(1);
  });
}

reviewApproveButton.addEventListener("click", () => markReview("aprovado"));
reviewFlagButton.addEventListener("click", () => markReview("revisar"));

reviewExportButton.addEventListener("click", () =>
  handleReviewNavigation(async () => {
    await getAuditedReviewSequence();
    saveCurrentReviewNote();

    const file = await fs.getFileForSaving(
      "PipeEditorAI_Revisao_23_Cortes.json",
      { types: ["json"] }
    );

    if (!file) return;

    const approved = reviewSession.cuts.filter(
      c => c.verdict === "aprovado"
    ).length;
    const flagged = reviewSession.cuts.filter(
      c => c.verdict === "revisar"
    ).length;

    const report = {
      version: "1.0-review",
      sourceSequence: reviewSession.sourceName,
      editedSequence: reviewSession.sequenceName,
      fps: reviewSession.fps,
      checked: reviewSession.cuts.length - reviewSession.cuts.filter(
        c => c.verdict === "pendente"
      ).length,
      approved,
      flagged,
      exportedAt: new Date().toISOString(),
      cuts: reviewSession.cuts.map(c => ({ ...c }))
    };

    await file.write(JSON.stringify(report, null, 2));
    reviewStatus.className = "success";
    reviewStatus.textContent =
      "Relatório salvo: " + file.name + "\n" +
      "Aprovados: " + approved + " · Revisar: " +
      flagged + ".\n" +
      "Nenhum clipe foi modificado.";
  })
);
