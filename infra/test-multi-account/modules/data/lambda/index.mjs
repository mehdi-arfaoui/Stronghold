export const handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "hello from stronghold e2e",
    }),
  };
};
