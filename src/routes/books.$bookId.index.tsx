import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/books/$bookId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/books/$bookId/dashboard",
      params: { bookId: params.bookId },
    });
  },
});

