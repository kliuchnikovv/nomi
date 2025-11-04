try:
    import httpx
except ImportError:
    raise ImportError("The 'httpx' module is required. Run 'pip install httpx' to install.")

from agno.tools import Toolkit

class GoogleMapsTool(Toolkit):
    def __init__(
        self,
        api_key: str
    ):
        super().__init__(name="google_maps_tool")
        self.api_key = api_key
        self.base_url = "https://maps.googleapis.com/maps/api"

        self.register(self.get_place_maps_url)

    def get_place_maps_url(self, place_name: str) -> str:
        """
        Get the Google Maps URL for the given place name.
        :param place_name: The name of the place.
        :return: The Google Maps URL.
        """

        search_endpoint = f'{self.base_url}/place/textsearch/json'
        params = {
            'key': self.api_key,
            'query': place_name,
            'fields': 'place_id',
        }
        try:
            response = httpx.get(search_endpoint, params=params)
            response.raise_for_status()
            data = response.json()
            if 'error_message' in data:
                raise Exception(data['error_message'])

            if 'results' in data:
                place_id = data['results'][0]['place_id']

                # Create a Google Maps URL using the place_id
                return f'https://www.google.com/maps/place/?q=place_id:{place_id}'

        except httpx.HTTPStatusError as e:
            return f'HTTP error occurred: {str(e)}'
        except Exception as e:
            return f'Unexpected error: {str(e)}'