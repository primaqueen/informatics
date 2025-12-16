import CloseIcon from "@mui/icons-material/Close";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import {
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  SwipeableDrawer,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React from "react";

export interface KesDetailsItem {
  raw: string;
  code: string;
  title: string;
  section: string;
  count?: number;
}

interface Props {
  item: KesDetailsItem | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onToggleFilter?: (code: string) => void;
  isCodeSelected?: boolean;
}

function KesDetailsContent({
  item,
  onClose,
  onToggleFilter,
  isCodeSelected = false,
}: {
  item: KesDetailsItem;
  onClose: () => void;
  onToggleFilter?: (code: string) => void;
  isCodeSelected?: boolean;
}) {
  const hasTitle = item.title.trim() && item.title.trim() !== item.code;
  const hasRaw = item.raw.trim() && item.raw.trim() !== item.code && item.raw.trim() !== item.title.trim();

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={700} noWrap>
            {item.code}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Раздел {item.section}
            {typeof item.count === "number" ? ` · задач: ${item.count}` : ""}
          </Typography>
        </Box>
        <IconButton aria-label="Закрыть" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>

      {hasTitle ? <Typography>{item.title}</Typography> : null}
      {hasRaw ? (
        <Box>
          <Typography variant="body2" color="text.secondary">
            В исходнике:
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {item.raw}
          </Typography>
        </Box>
      ) : null}

      {onToggleFilter ? (
        <Button
          variant={isCodeSelected ? "outlined" : "contained"}
          startIcon={<FilterAltIcon />}
          onClick={() => onToggleFilter(item.code)}
        >
          {isCodeSelected ? "Убрать из фильтра" : "Добавить в фильтр"}
        </Button>
      ) : null}
    </Stack>
  );
}

export function KesDetailsOverlay({ item, anchorEl, onClose, onToggleFilter, isCodeSelected }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  if (!item) return null;

  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={Boolean(item)}
        onClose={onClose}
        onOpen={() => undefined}
        disableSwipeToOpen
        swipeAreaWidth={24}
        ModalProps={{ keepMounted: true }}
        sx={{ zIndex: (muiTheme) => muiTheme.zIndex.modal + 1 }}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "70vh",
            overflow: "hidden",
          },
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 4, bgcolor: "text.disabled" }} />
        </Box>
        <Box sx={{ px: 2, pt: 1, pb: 2, overflow: "auto", height: "100%" }}>
          <KesDetailsContent
            item={item}
            onClose={onClose}
            onToggleFilter={onToggleFilter}
            isCodeSelected={isCodeSelected}
          />
        </Box>
      </SwipeableDrawer>
    );
  }

  return (
    <Popover
      open={Boolean(item) && Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      PaperProps={{ sx: { p: 2, width: 380, maxWidth: "90vw" } }}
    >
      <KesDetailsContent
        item={item}
        onClose={onClose}
        onToggleFilter={onToggleFilter}
        isCodeSelected={isCodeSelected}
      />
    </Popover>
  );
}

