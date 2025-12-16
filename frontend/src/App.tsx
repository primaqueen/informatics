import {
  AppBar,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Pagination,
  Toolbar,
  Typography,
  CssBaseline,
  ThemeProvider,
  createTheme,
  TextField,
  InputAdornment,
  Stack,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Checkbox,
  ListItemIcon,
  Chip,
  MenuItem,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import React, { useEffect, useMemo, useState } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useTasks } from "./hooks/useTasks";
import { TaskCard } from "./components/TaskCard";
import { KesDetailsOverlay } from "./components/KesDetailsOverlay";
import kesReference from "./reference/kes.json";

const DevTaskEditorDialog = import.meta.env.DEV
  ? React.lazy(async () => {
      const mod = await import("./components/TaskEditorDialog");
      return { default: mod.TaskEditorDialog };
    })
  : null;

interface KesItem {
  raw: string;
  code: string;
  title: string;
  section: string;
  count: number;
}

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
  },
});

const PAGE_SIZE = 10;
const TASK_NUMBER_ALL_VALUE = "all";
const TASK_NUMBER_UNASSIGNED_VALUE = "no-number";
const QUERY_PARAM_SEARCH = "q";
const QUERY_PARAM_TASK_NUMBER = "num";

function App() {
  const { tasks, loading, error, applyOverride } = useTasks();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(QUERY_PARAM_SEARCH) ?? "";
  });
  const [taskNumberFilter, setTaskNumberFilter] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(QUERY_PARAM_TASK_NUMBER);
    if (raw === TASK_NUMBER_UNASSIGNED_VALUE) return TASK_NUMBER_UNASSIGNED_VALUE;
    if (raw && /^\d+$/.test(raw)) return raw;
    return TASK_NUMBER_ALL_VALUE;
  });
  const [selectedKes, setSelectedKes] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [kesDetails, setKesDetails] = useState<{
    item: KesItem;
    anchorEl: HTMLElement | null;
  } | null>(null);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(search.trim()) ||
      taskNumberFilter !== TASK_NUMBER_ALL_VALUE ||
      selectedKes.length > 0,
    [search, selectedKes.length, taskNumberFilter],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const normalizedSearch = search.trim();

    if (normalizedSearch) {
      params.set(QUERY_PARAM_SEARCH, normalizedSearch);
    } else {
      params.delete(QUERY_PARAM_SEARCH);
    }

    if (taskNumberFilter === TASK_NUMBER_ALL_VALUE) {
      params.delete(QUERY_PARAM_TASK_NUMBER);
    } else {
      params.set(QUERY_PARAM_TASK_NUMBER, taskNumberFilter);
    }

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${
      window.location.hash
    }`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [search, taskNumberFilter]);

  const kesCatalog = useMemo(() => {
    const byId = new Map<string, { text: string; section: string }>();
    (kesReference as Array<{ id: string; text: string; section: number }>).forEach(
      ({ id, text, section }) => {
        byId.set(id, {
          text,
          section: String(section ?? id.split(".")[0] ?? ""),
        });
      },
    );
    return byId;
  }, []);

  const taskNumberOptions = useMemo(
    () =>
      Array.from(
        tasks.reduce((acc, task) => {
          const key = task.task_number ?? null;
          acc.set(key, (acc.get(key) ?? 0) + 1);
          return acc;
        }, new Map<number | null, number>()),
      )
        .map(([numberValue, count]) => ({
          value: numberValue === null ? TASK_NUMBER_UNASSIGNED_VALUE : String(numberValue),
          numberValue,
          display: numberValue === null ? "Без номера" : `№ ${numberValue}`,
          count,
        }))
        .sort((a, b) => {
          if (a.numberValue === null) return -1;
          if (b.numberValue === null) return 1;
          return (a.numberValue ?? 0) - (b.numberValue ?? 0);
        }),
    [tasks],
  );

  const kesItems = useMemo<KesItem[]>(() => {
    const counts = new Map<string, number>();
    tasks.forEach((task) => {
      task.meta?.["КЭС"]?.forEach((item) => {
        counts.set(item, (counts.get(item) ?? 0) + 1);
      });
    });

    return Array.from(counts.entries()).map(([raw, count]) => {
      const [code, ...rest] = raw.split(" ");
      const ref = kesCatalog.get(code);
      const titleFromRef = ref?.text?.replace(new RegExp(`^${code}\\s*`), "").trim();
      const title = titleFromRef || rest.join(" ").trim();
      const section = ref?.section || code.split(".")[0] || code;
      return { raw, code, title, section, count };
    });
  }, [tasks, kesCatalog]);

  const kesItemsByRaw = useMemo(() => new Map(kesItems.map((item) => [item.raw, item])), [kesItems]);

  const kesSections = useMemo(
    () =>
      Array.from(
        kesItems.reduce((acc, item) => {
          const list = acc.get(item.section) ?? [];
          list.push(item);
          acc.set(item.section, list);
          return acc;
        }, new Map<string, KesItem[]>()),
      )
        .map(([section, items]) => ({
          section,
          items: items.sort((a, b) => a.code.localeCompare(b.code, "ru", { numeric: true })),
          count: items.reduce((sum, current) => sum + current.count, 0),
        }))
        .sort((a, b) => Number(a.section) - Number(b.section)),
    [kesItems],
  );

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const ids = [task.internal_id, task.meta?.internal_id, task.qid, task.suffix];
      const matchesSearch = !query || ids.some((value) => value?.toLowerCase().includes(query));

      const kesCodes = task.meta?.["КЭС"]?.map((value) => value.split(" ")[0]) ?? [];
      const matchesKes =
        selectedKes.length === 0 ||
        kesCodes.some((code) =>
          selectedKes.some((sel) => code === sel || code.startsWith(`${sel}.`)),
        );

      const matchesTaskNumber =
        taskNumberFilter === TASK_NUMBER_ALL_VALUE ||
        (taskNumberFilter === TASK_NUMBER_UNASSIGNED_VALUE
          ? task.task_number == null
          : String(task.task_number) === taskNumberFilter);

      return matchesSearch && matchesKes && matchesTaskNumber;
    });
  }, [search, tasks, selectedKes, taskNumberFilter]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE)),
    [filteredTasks],
  );

  const pageTasks = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTasks.slice(start, start + PAGE_SIZE);
  }, [page, filteredTasks]);

  const editingTask = useMemo(
    () => (editingTaskId ? tasks.find((task) => task.internal_id === editingTaskId) ?? null : null),
    [editingTaskId, tasks],
  );

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setPage(1);
  };

  const clearAllFilters = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    event?.preventDefault();
    setSearch("");
    setTaskNumberFilter(TASK_NUMBER_ALL_VALUE);
    setSelectedKes([]);
    setPage(1);
  };

  const handleTaskNumberChange = (event: SelectChangeEvent<string>) => {
    setTaskNumberFilter(event.target.value);
    setPage(1);
  };

  const openSearchPanel = () => setSearchOpen(true);
  const closeSearchPanel = () => setSearchOpen(false);
  const closeKesDetails = () => setKesDetails(null);

  const filtersSummary = useMemo(() => {
    const parts: string[] = [];
    if (search.trim()) parts.push(search.trim());
    if (taskNumberFilter !== TASK_NUMBER_ALL_VALUE) {
      const selectedNumber = taskNumberOptions.find((option) => option.value === taskNumberFilter);
      if (selectedNumber) parts.push(`Номер: ${selectedNumber.display}`);
    }
    if (selectedKes.length) {
      const visible = selectedKes.slice(0, 3).join(", ");
      const more = selectedKes.length > 3 ? ` +${selectedKes.length - 3}` : "";
      parts.push(`КЭС: ${visible}${more}`);
    }
    return parts.join(" · ") || "Поиск по internal_id / qid / suffix";
  }, [search, selectedKes, taskNumberFilter, taskNumberOptions]);

  const toggleKes = (code: string) => {
    setSelectedKes((prev) => {
      const exists = prev.includes(code);
      const next = exists ? prev.filter((c) => c !== code) : [...prev, code];
      return next;
    });
    setPage(1);
  };

  const clearKes = () => {
    setSelectedKes([]);
    setPage(1);
  };

  const openKesDetails = (item: KesItem, anchorEl: HTMLElement | null) => {
    setKesDetails({ item, anchorEl });
  };

  const handleKesClick = (raw: string, anchorEl: HTMLElement) => {
    const found = kesItemsByRaw.get(raw);
    if (found) {
      openKesDetails(found, anchorEl);
      return;
    }

    const [code, ...rest] = raw.split(" ");
    const ref = kesCatalog.get(code);
    const titleFromRef = ref?.text?.replace(new RegExp(`^${code}\\s*`), "").trim();
    const title = titleFromRef || rest.join(" ").trim();
    const section = ref?.section || code.split(".")[0] || code;
    openKesDetails({ raw, code, title, section, count: 0 }, anchorEl);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="sticky">
        <Toolbar>
          <Typography variant="h6" sx={{ mr: 2 }}>
            FIPI Tasks Viewer
          </Typography>
          <Box sx={{ flexGrow: 1, display: "flex", justifyContent: "center" }}>
            <TextField
              size="small"
              variant="outlined"
              value={filtersSummary}
              onClick={openSearchPanel}
              sx={{ width: "100%", maxWidth: 520, backgroundColor: "white", borderRadius: 1 }}
              InputProps={{
                readOnly: true,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: hasActiveFilters ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label="Сбросить фильтры"
                      onClick={clearAllFilters}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
          </Box>
          <IconButton color="inherit" onClick={() => window.location.reload()}>
            <RefreshIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Dialog
        open={searchOpen}
        onClose={closeSearchPanel}
        fullWidth
        maxWidth="lg"
        fullScreen={false}
        disableRestoreFocus
        PaperProps={{ sx: { height: { xs: "100%", md: "80vh" } } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Поиск и фильтры
          </Typography>
          <IconButton onClick={closeSearchPanel} aria-label="Закрыть">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              autoFocus
              label="internal_id / qid / suffix"
              value={search}
              onChange={handleSearchChange}
              placeholder="Например: 48F84F или q4D2E4A"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: hasActiveFilters ? (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="Сбросить фильтры" onClick={clearAllFilters}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />

            <TextField
              select
              label="Номер задачи"
              value={taskNumberFilter}
              onChange={handleTaskNumberChange}
              helperText="Выберите номер из списка или оставьте все задачи"
            >
              <MenuItem value={TASK_NUMBER_ALL_VALUE}>Все номера</MenuItem>
              {taskNumberOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ width: "100%", justifyContent: "space-between" }}
                  >
                    <Typography component="span">{option.display}</Typography>
                    <Typography component="span" variant="body2" color="text.secondary">
                      Задач: {option.count}
                    </Typography>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                Фильтр по КЭС
              </Typography>
              <Button size="small" onClick={clearKes} variant="outlined">
                Сбросить КЭС
              </Button>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                gap: 2,
                maxHeight: { xs: "60vh", md: "56vh" },
                overflow: "auto",
              }}
            >
              {kesSections.map((section) => (
                <Box key={section.section}>
                  <Typography variant="subtitle2" sx={{ color: "text.secondary", mb: 0.5 }}>
                    Раздел {section.section} · задач: {section.count}
                  </Typography>
                  <List dense disablePadding>
                    <ListItemButton
                      selected={selectedKes.includes(section.section)}
                      onClick={() => toggleKes(section.section)}
                      sx={{ borderRadius: 1, mb: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          edge="start"
                          tabIndex={-1}
                          disableRipple
                          checked={selectedKes.includes(section.section)}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Все КЭС раздела ${section.section}`}
                        secondary={`Всего задач: ${section.count}`}
                      />
                    </ListItemButton>
	                    {section.items.map((item) => (
	                      <ListItemButton
	                        key={item.code}
	                        selected={selectedKes.includes(item.code)}
	                        onClick={() => toggleKes(item.code)}
	                        sx={{ borderRadius: 1, mb: 0.5 }}
	                      >
	                        <ListItemIcon sx={{ minWidth: 36 }}>
	                          <Checkbox
	                            edge="start"
	                            tabIndex={-1}
	                            disableRipple
	                            checked={selectedKes.includes(item.code)}
	                          />
	                        </ListItemIcon>
	                        <ListItemText
	                          primary={item.code}
	                          secondary={`Задач: ${item.count}`}
	                        />
	                        <IconButton
	                          size="small"
	                          aria-label={`Детали КЭС ${item.code}`}
	                          onClick={(event) => {
	                            event.stopPropagation();
	                            openKesDetails(item, event.currentTarget);
	                          }}
	                        >
	                          <InfoOutlinedIcon fontSize="small" />
	                        </IconButton>
	                      </ListItemButton>
	                    ))}
	                  </List>
	                </Box>
	              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Stack
            direction="row"
            spacing={1}
            sx={{ px: 1, width: "100%", justifyContent: "flex-end" }}
          >
            {selectedKes.length > 0 && (
              <Chip
                size="small"
                label={`Выбрано КЭС: ${selectedKes.length}`}
                onDelete={clearKes}
                variant="outlined"
              />
            )}
            <Button onClick={closeSearchPanel}>Закрыть</Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <Container maxWidth="md" sx={{ py: 3 }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Typography color="error" sx={{ my: 2 }}>
            Ошибка загрузки: {error}
          </Typography>
        )}
        {!loading && !error && (
          <>
            {pageTasks.length ? (
              pageTasks.map((task) => (
                <TaskCard
                  key={task.qid}
                  task={task}
                  onEdit={() => setEditingTaskId(task.internal_id)}
                  onKesClick={handleKesClick}
                />
              ))
            ) : (
              <Typography sx={{ my: 2 }}>Ничего не найдено.</Typography>
            )}
            {filteredTasks.length > PAGE_SIZE && (
              <Box sx={{ display: "flex", justifyContent: "center", my: 3 }}>
                <Pagination
                  count={pageCount}
                  page={page}
                  onChange={handlePageChange}
                  color="primary"
                  showFirstButton
                  showLastButton
                />
              </Box>
            )}
          </>
        )}
      </Container>

      {import.meta.env.DEV && DevTaskEditorDialog ? (
        <React.Suspense fallback={null}>
          <DevTaskEditorDialog
            open={Boolean(editingTask)}
            task={editingTask}
            onClose={() => setEditingTaskId(null)}
            onSaved={(internalId, override) => applyOverride(internalId, override)}
          />
        </React.Suspense>
      ) : null}

      <KesDetailsOverlay
        item={kesDetails?.item ?? null}
        anchorEl={kesDetails?.anchorEl ?? null}
        onClose={closeKesDetails}
        onToggleFilter={toggleKes}
        isCodeSelected={kesDetails ? selectedKes.includes(kesDetails.item.code) : false}
      />
    </ThemeProvider>
  );
}

export default App;
